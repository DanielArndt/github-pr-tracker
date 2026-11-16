// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import Soup from 'gi://Soup';
import { GithubClient, RequestCancelledError, ApiHttpError, parseGraphQLResponse } from '../src/api/githubClient.js';

// Soup 3 does not introspect request body getters, so the payload is
// captured when the client attaches it to the message.
const originalSetRequestBody = Soup.Message.prototype.set_request_body_from_bytes;
Soup.Message.prototype.set_request_body_from_bytes = function (contentType, bytes) {
    this._testPayload = new TextDecoder().decode(bytes.get_data());
    originalSetRequestBody.call(this, contentType, bytes);
};

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✓ PASS: ${testName}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${testName}`);
        failed++;
    }
}

/**
 * Stand-in for Soup.Session that records requests and lets the test decide
 * when and how each one completes.
 */
class FakeSession {
    constructor() {
        this.requests = [];
    }

    send_and_read_async(message, priority, cancellable, callback) {
        this.requests.push({
            message,
            cancellable,
            callback,
            body: message._testPayload || '',
        });
    }

    send_and_read_finish(result) {
        if (result.cancelled) {
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
        }
        if ('body' in result) {
            return new GLib.Bytes(new TextEncoder().encode(result.body));
        }
        throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED, 'Network down');
    }

    /** Completes a request the way Soup does once its cancellable fires. */
    finishCancelled(index) {
        const req = this.requests[index];
        req.callback(this, { cancelled: true });
    }

    finishFailed(index) {
        const req = this.requests[index];
        req.callback(this, { cancelled: false });
    }

    /**
     * Completes a request with an HTTP status, reason phrase and body.
     * @param {number} index
     * @param {Object} response
     * @param {number} response.status
     * @param {string} [response.reason]
     * @param {string} [response.body]
     * @param {number|null} [response.retryAfter] Retry-After header value
     */
    finishResponse(index, { status, reason = '', body = '', retryAfter = null }) {
        const req = this.requests[index];
        req.message.get_status = () => status;
        req.message.get_reason_phrase = () => reason;
        req.message.get_response_headers = () => ({
            get_one: name => name === 'Retry-After' && retryAfter !== null ? String(retryAfter) : null,
        });
        req.callback(this, { cancelled: false, body });
    }

    abort() {}
}

function makeClient() {
    const client = new GithubClient('ghp_test');
    client._session = new FakeSession();
    return client;
}

/** Resolves to 'resolved', the rejection reason, or 'pending' after a tick. */
function settle(promise) {
    return Promise.race([
        promise.then(() => 'resolved', err => err),
        new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            resolve('pending');
            return GLib.SOURCE_REMOVE;
        })),
    ]);
}

console.log('--- Testing GitHub Client ---');

// A superseded request rejects instead of hanging forever
{
    const client = makeClient();
    const first = client.executeQuery('query { a }');
    const second = client.executeQuery('query { b }');
    const session = client._session;

    assert(session.requests[0].cancellable.is_cancelled(), 'Starting a new request cancels the previous one');
    assert(!session.requests[1].cancellable.is_cancelled(), 'Newest request is not cancelled');

    session.finishCancelled(0);
    const outcome = await settle(first);
    assert(outcome instanceof RequestCancelledError, 'Cancelled request rejects with RequestCancelledError');

    // Late callback of the cancelled request must not drop the newer handle
    assert(client._cancellable === session.requests[1].cancellable,
        'Cancelled request does not clear the newer request\'s cancellable');

    client.cancelPending();
    assert(session.requests[1].cancellable.is_cancelled(), 'Newer request can still be cancelled');
    session.finishCancelled(1);
    assert((await settle(second)) instanceof RequestCancelledError, 'Second request rejects after cancelPending');
}

/** Resolves once the predicate holds, polling the main loop. */
function waitFor(predicate) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
            if (predicate()) {
                resolve();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    });
}

const okBody = fields => JSON.stringify({ data: fields });

// Transient 5xx responses are retried and can then succeed
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    session.finishResponse(0, { status: 502, reason: 'Bad Gateway', retryAfter: 1 });
    await waitFor(() => session.requests.length === 2);
    assert(session.requests.length === 2, '5xx responses are retried');
    session.finishResponse(1, { status: 200, body: okBody({ viewer: { login: 'octocat' } }) });
    const result = await pending;
    assert(result.data.viewer.login === 'octocat', 'Retried request returns the successful response');
}

// A queued 5xx completion after destroy must not resurrect a retry source
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    client.destroy();
    session.finishResponse(0, { status: 502, reason: 'Bad Gateway', retryAfter: 1 });
    assert((await settle(pending)) instanceof RequestCancelledError,
        'Queued HTTP failure after destroy rejects as cancellation immediately');
    assert(client._retrySources.size === 0, 'Queued HTTP failure cannot create a retry after destroy');
    client.cancelPending();
    await settle(pending);
}

// A queued success cannot start another page of a cancelled cycle
{
    const client = makeClient();
    const session = client._session;
    const pending = client._fetchBucket('query { a }', 'authored', new Gio.Cancellable());
    session.requests[0].cancellable.cancel();
    session.finishResponse(0, {
        status: 200,
        body: okBody({ authored: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'NEXT' } } }),
    });
    assert((await settle(pending)) instanceof RequestCancelledError,
        'Queued successful page after cancellation rejects immediately');
    assert(session.requests.length === 1, 'Cancelled cycle cannot start its next page');
    if (session.requests.length > 1) {
        session.finishCancelled(1);
        await settle(pending);
    }
}

// Non-retryable HTTP errors are not retried
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    session.finishResponse(0, { status: 403, reason: 'Forbidden' });
    const outcome = await settle(pending);
    assert(outcome instanceof ApiHttpError && outcome.statusCode === 403,
        '403 responses reject immediately with ApiHttpError');
    assert(session.requests.length === 1, '403 responses are not retried');
}

// Retries are exhausted eventually and the last error is thrown
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    session.finishResponse(0, { status: 502, reason: 'Bad Gateway', retryAfter: 1 });
    await waitFor(() => session.requests.length === 2);
    session.finishResponse(1, { status: 502, reason: 'Bad Gateway', retryAfter: 1 });
    await waitFor(() => session.requests.length === 3);
    session.finishResponse(2, { status: 502, reason: 'Bad Gateway', retryAfter: 1 });
    const outcome = await settle(pending);
    assert(outcome instanceof ApiHttpError && outcome.statusCode === 502,
        'Persistent 5xx responses reject with the last ApiHttpError');
    assert(session.requests.length === 3, 'At most 3 attempts are made (initial + 2 retries)');
}

// fetchAllPRs merges the three bucket requests and degrades on bucket failure
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    await waitFor(() => session.requests.length === 3);
    session.finishResponse(0, {
        status: 200,
        body: okBody({
            viewer: { login: 'octocat' },
            authored: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'PR_1' }] },
        }),
    });
    session.finishResponse(1, {
        status: 200,
        body: okBody({
            reviewRequested: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'PR_2' }] },
        }),
    });
    session.finishResponse(2, { status: 403, reason: 'Forbidden' });
    const result = await pending;
    assert(result.data.viewer.login === 'octocat' &&
        result.data.authored.nodes[0].id === 'PR_1' &&
        result.data.reviewRequested.nodes[0].id === 'PR_2',
        'Successful buckets are merged into one result');
    assert(result.data.assigned.nodes.length === 0,
        'Failed bucket contributes no nodes');
    assert(result.errors.length === 1 && result.errors[0].message.includes('403'),
        'Failed bucket is reported as a non-fatal error');
}

// Every bucket can supply identity when the authored request fails
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    assert(session.requests.every(req => /viewer\s*\{\s*login\s*\}/.test(JSON.parse(req.body).query)),
        'All bucket queries request the authenticated viewer');
    session.finishResponse(0, { status: 403, reason: 'Forbidden' });
    session.finishResponse(1, {
        status: 200,
        body: okBody({
            viewer: { login: 'new-account' },
            reviewRequested: { nodes: [], pageInfo: { hasNextPage: false } },
        }),
    });
    session.finishResponse(2, {
        status: 200,
        body: okBody({
            viewer: { login: 'new-account' },
            assigned: { nodes: [], pageInfo: { hasNextPage: false } },
        }),
    });
    const result = await pending;
    assert(result.data.viewer?.login === 'new-account',
        'Surviving buckets supply identity even without authored results');
}

// fetchAllPRs paginates buckets whose first page reports more results
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    await waitFor(() => session.requests.length === 3);
    session.finishResponse(0, {
        status: 200,
        body: okBody({
            viewer: { login: 'octocat' },
            authored: {
                pageInfo: { hasNextPage: true, endCursor: 'CURSOR_1' },
                nodes: [{ id: 'PR_1' }],
            },
        }),
    });
    session.finishResponse(1, {
        status: 200,
        body: okBody({
            reviewRequested: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'PR_2' }] },
        }),
    });
    session.finishResponse(2, {
        status: 200,
        body: okBody({ assigned: { pageInfo: { hasNextPage: false }, nodes: [] } }),
    });
    await waitFor(() => session.requests.length === 4);
    assert(session.requests.length === 4, 'A bucket with more pages sends a follow-up request');
    const pageBody = JSON.parse(session.requests[3].body);
    assert(pageBody.variables.after === 'CURSOR_1',
        'The follow-up request passes the previous page cursor');
    session.finishResponse(3, {
        status: 200,
        body: okBody({
            authored: {
                pageInfo: { hasNextPage: false },
                nodes: [{ id: 'PR_3' }],
            },
        }),
    });
    const result = await pending;
    assert(result.data.authored.nodes.map(n => n.id).join(',') === 'PR_1,PR_3',
        'Pages of one bucket are concatenated in order');
    assert(result.data.authored.pageInfo.hasNextPage === false,
        'Bucket pagination stops at the last page');
}

// fetchAllPRs stops paginating at the page cap and keeps the truncated flag
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    await waitFor(() => session.requests.length === 3);
    const morePages = i => ({
        status: 200,
        body: okBody({
            viewer: { login: 'octocat' },
            authored: {
                pageInfo: { hasNextPage: true, endCursor: `CURSOR_${i}` },
                nodes: [{ id: `PR_${i}` }],
            },
        }),
    });
    session.finishResponse(0, morePages(1));
    session.finishResponse(1, {
        status: 200,
        body: okBody({ reviewRequested: { pageInfo: { hasNextPage: false }, nodes: [] } }),
    });
    session.finishResponse(2, {
        status: 200,
        body: okBody({ assigned: { pageInfo: { hasNextPage: false }, nodes: [] } }),
    });
    await waitFor(() => session.requests.length === 4);
    session.finishResponse(3, morePages(2));
    await waitFor(() => session.requests.length === 5);
    session.finishResponse(4, morePages(3));
    const result = await pending;
    assert(session.requests.length === 5,
        'Buckets request at most MAX_PAGES_PER_BUCKET pages');
    assert(result.data.authored.nodes.length === 3, 'All fetched pages are kept');
    assert(result.data.authored.pageInfo.hasNextPage === true,
        'Truncation is reported when more pages exist beyond the cap');
}

// A null follow-up connection must not erase the truncation warning
{
    const client = makeClient();
    const session = client._session;
    const pending = client._fetchBucket('query { a }', 'authored', new Gio.Cancellable());
    session.finishResponse(0, {
        status: 200,
        body: okBody({ authored: { nodes: [{ id: 'PR_1' }], pageInfo: { hasNextPage: true, endCursor: 'NEXT' } } }),
    });
    await waitFor(() => session.requests.length === 2);
    session.finishResponse(1, {
        status: 200,
        body: JSON.stringify({ data: { authored: null }, errors: [{ message: 'Search unavailable' }] }),
    });
    const result = await pending;
    assert(result.connection.pageInfo.hasNextPage, 'Null follow-up page preserves the incomplete-list warning');
    assert(result.connection.nodes.length === 1, 'Null follow-up page retains the loaded nodes');
    assert(result.errors.length > 0, 'Null follow-up page remains a partial failure');
}

// Even a null connection without GraphQL errors must not be treated as an empty list
{
    const client = makeClient();
    const session = client._session;
    const pending = client._fetchBucket('query { a }', 'assigned', new Gio.Cancellable());
    session.finishResponse(0, { status: 200, body: okBody({ assigned: null }) });
    const result = await pending;
    assert(result.errors.length > 0 && result.fatalError !== null,
        'Null initial connection reports a bucket failure rather than successful emptiness');
    assert(result.connection.pageInfo.hasNextPage, 'Null initial connection reports an incomplete list');
}

// fetchAllPRs throws when every bucket fails
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    await waitFor(() => session.requests.length === 3);
    session.finishResponse(0, { status: 403, reason: 'Forbidden' });
    session.finishResponse(1, { status: 403, reason: 'Forbidden' });
    session.finishResponse(2, { status: 403, reason: 'Forbidden' });
    const outcome = await settle(pending);
    assert(outcome instanceof ApiHttpError && outcome.statusCode === 403,
        'fetchAllPRs rejects with the first error when all buckets fail');
}

// Cancelling the refresh cycle rejects fetchAllPRs
{
    const client = makeClient();
    const session = client._session;
    const pending = client.fetchAllPRs();
    await waitFor(() => session.requests.length === 3);
    client.cancelPending();
    for (let i = 0; i < 3; i++) {
        session.finishCancelled(i);
    }
    assert((await settle(pending)) instanceof RequestCancelledError,
        'cancelPending rejects the whole refresh cycle');
}

// Destroying the client rejects the pending request
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    client.destroy();
    assert(session.requests[0].cancellable.is_cancelled(), 'destroy() cancels the in-flight request');
    session.finishCancelled(0);
    assert((await settle(pending)) instanceof RequestCancelledError, 'destroy() rejects the pending promise');
}

// Non-cancellation errors are passed through unchanged
{
    const client = makeClient();
    const session = client._session;
    const pending = client.executeQuery('query { a }');
    session.finishFailed(0);
    const outcome = await settle(pending);
    assert(!(outcome instanceof RequestCancelledError) && outcome?.message === 'Network down',
        'Network errors are not reported as cancellations');
    assert(client._cancellable === null, 'Finished request clears its own cancellable');
}

console.log('--- Testing GraphQL Response Parsing ---');

function parseError(...args) {
    try {
        parseGraphQLResponse(...args);
        return null;
    } catch (e) {
        return e.message;
    }
}

// Full success
{
    const body = JSON.stringify({ data: { viewer: { login: 'octocat' } } });
    const result = parseGraphQLResponse(200, 'OK', body);
    assert(result.data.viewer.login === 'octocat', 'Returns data on success');
    assert(Array.isArray(result.errors) && result.errors.length === 0, 'Returns empty errors on success');
}

// Partial data with errors (e.g. SAML-protected organization)
{
    const body = JSON.stringify({
        data: {
            viewer: { login: 'octocat', pullRequests: { nodes: [{ id: 'PR_1' }, null] } },
            reviewRequested: { nodes: [{ id: 'PR_2' }] },
        },
        errors: [{
            type: 'FORBIDDEN',
            path: ['viewer', 'pullRequests', 'nodes', 1],
            message: 'Resource protected by organization SAML enforcement.',
        }],
    });
    const result = parseGraphQLResponse(200, 'OK', body);
    assert(result.data.viewer.pullRequests.nodes[0].id === 'PR_1', 'Keeps partial data when errors are present');
    assert(result.data.reviewRequested.nodes.length === 1, 'Keeps unaffected fields');
    assert(result.errors.length === 1 && result.errors[0].type === 'FORBIDDEN', 'Returns partial errors');
}

// Errors without data are fatal
{
    const body = JSON.stringify({ data: null, errors: [{ message: 'Something broke' }] });
    assert(parseError(200, 'OK', body) === 'GraphQL error: Something broke', 'Rejects errors with null data');

    const noData = JSON.stringify({ errors: [{ message: 'A' }, { message: 'B' }] });
    assert(parseError(200, 'OK', noData) === 'GraphQL error: A; B', 'Rejects errors without data, joining messages');

    assert(parseError(200, 'OK', '{}') === 'GraphQL error: Response contained no data', 'Rejects empty body');
    assert(parseError(200, 'OK', 'null') === 'GraphQL error: Response contained no data', 'Rejects JSON null body');
}

// HTTP and parse errors
{
    assert(parseError(401, 'Unauthorized', '')?.includes('401'), 'Rejects 401');
    assert(parseError(403, 'Forbidden', '')?.includes('403'), 'Rejects 403');
    assert(parseError(502, 'Bad Gateway', '') === 'GitHub API error HTTP 502: Bad Gateway', 'Rejects other HTTP errors');
    assert(parseError(200, 'OK', '<html>')?.startsWith('Failed to parse GitHub response'), 'Rejects invalid JSON');
}

console.log(`\nGitHub Client Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
