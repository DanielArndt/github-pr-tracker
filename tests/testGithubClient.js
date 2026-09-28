// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { GithubClient, RequestCancelledError } from '../src/api/githubClient.js';

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
        this.requests.push({ message, cancellable, callback });
    }

    send_and_read_finish(result) {
        if (result.cancelled) {
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
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

console.log(`\nGitHub Client Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
