// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    AUTHORED_PRS_QUERY,
    REVIEW_REQUESTED_PRS_QUERY,
    ASSIGNED_PRS_QUERY,
    VERIFY_USER_QUERY,
    MAX_PAGES_PER_BUCKET,
} from './queries.js';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'GNOME-Shell-GitHub-PR-Tracker/1.0';

/** Maximum number of retries for transient server errors (HTTP 5xx). */
const MAX_RETRIES = 2;
/** Backoff in seconds between retries when GitHub sends no Retry-After header. */
const RETRY_BACKOFF_SECONDS = [5, 15];
/** Bounds applied to a server-provided Retry-After value, in seconds. */
const RETRY_AFTER_MIN_SECONDS = 1;
const RETRY_AFTER_MAX_SECONDS = 60;

/**
 * Rejection reason for requests that were cancelled, either because a newer
 * request superseded them or because the client was destroyed.
 */
export class RequestCancelledError extends Error {
    constructor() {
        super('Request cancelled');
        this.name = 'RequestCancelledError';
    }
}

/**
 * Rejection reason for HTTP-level errors reported by the GitHub API.
 */
export class ApiHttpError extends Error {
    /**
     * @param {number} statusCode
     * @param {string} message
     * @param {number|null} retryAfterSeconds value of the Retry-After header, if present
     */
    constructor(statusCode, message, retryAfterSeconds = null) {
        super(message);
        this.name = 'ApiHttpError';
        this.statusCode = statusCode;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/**
 * @typedef {Object} GraphQLResult
 * @property {Object} data response data; fields GitHub could not resolve are null
 * @property {Array<{message: string}>} errors non-fatal errors (empty when none)
 */

/**
 * Interprets a GitHub GraphQL HTTP response.
 *
 * GitHub may return partial `data` together with `errors`, for example when
 * some results belong to an organization that enforces SAML SSO. Those are
 * returned as non-fatal errors so the rest of the data can still be shown.
 * Only a response without any `data` is treated as a failure.
 *
 * @param {number} statusCode
 * @param {string|null} reasonPhrase
 * @param {string} responseText
 * @param {number|null} [retryAfterSeconds] value of the Retry-After header, if present
 * @returns {GraphQLResult}
 * @throws {ApiHttpError} on HTTP errors
 * @throws {Error} on invalid JSON or responses without data
 */
export function parseGraphQLResponse(statusCode, reasonPhrase, responseText, retryAfterSeconds = null) {
    if (statusCode === 401) {
        throw new ApiHttpError(401,
            'Authentication failed (401). Please verify your GitHub Personal Access Token.');
    }

    if (statusCode === 403) {
        throw new ApiHttpError(403, 'GitHub API rate limit exceeded or access forbidden (403).');
    }

    if (statusCode < 200 || statusCode >= 300) {
        throw new ApiHttpError(statusCode,
            `GitHub API error HTTP ${statusCode}: ${reasonPhrase || responseText}`,
            retryAfterSeconds);
    }

    let body;
    try {
        body = JSON.parse(responseText);
    } catch (parseErr) {
        throw new Error(`Failed to parse GitHub response: ${parseErr.message}`, { cause: parseErr });
    }

    const errors = Array.isArray(body?.errors) ? body.errors : [];

    if (!body?.data) {
        const errorMsg = errors.map(e => e.message).join('; ') || 'Response contained no data';
        throw new Error(`GraphQL error: ${errorMsg}`);
    }

    return { data: body.data, errors };
}

export class GithubClient {
    /**
     * @param {string|null} token
     */
    constructor(token = null) {
        this._token = token;
        this._session = new Soup.Session();
        this._session.timeout = 30; // 30 seconds
        this._cancellable = null;
        this._retrySources = new Map();
    }

    setToken(token) {
        this._token = token;
    }

    cancelPending() {
        this._cancelRetryDelays();
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
    }

    destroy() {
        this.cancelPending();
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }

    /**
     * Waits before a retry attempt. Rejects immediately when the request is
     * cancelled while the wait is still pending.
     * @param {number} seconds
     * @param {Gio.Cancellable} cancellable
     * @returns {Promise<void>}
     */
    _delayRetry(seconds, cancellable) {
        return new Promise((resolve, reject) => {
            const sourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                this._retrySources.delete(sourceId);
                if (cancellable.is_cancelled()) {
                    reject(new RequestCancelledError());
                } else {
                    resolve();
                }
                return GLib.SOURCE_REMOVE;
            });
            this._retrySources.set(sourceId, reject);
        });
    }

    /**
     * Removes and rejects all pending retry waits, e.g. when a newer request
     * supersedes the one waiting to retry.
     */
    _cancelRetryDelays() {
        for (const [sourceId, reject] of this._retrySources) {
            GLib.Source.remove(sourceId);
            reject(new RequestCancelledError());
        }
        this._retrySources.clear();
    }

    /**
     * Computes how long to wait before the next retry attempt.
     * @param {number} attempt zero-based retry index
     * @param {number|null} retryAfterSeconds server-provided Retry-After value
     * @returns {number} delay in seconds
     */
    _retryDelaySeconds(attempt, retryAfterSeconds) {
        if (retryAfterSeconds !== null) {
            return Math.min(
                Math.max(retryAfterSeconds, RETRY_AFTER_MIN_SECONDS),
                RETRY_AFTER_MAX_SECONDS
            );
        }
        return RETRY_BACKOFF_SECONDS[Math.min(attempt, RETRY_BACKOFF_SECONDS.length - 1)];
    }

    /**
     * Sends a single GraphQL request and interprets the response.
     * @param {string} queryString
     * @param {Object} variables
     * @param {string} token
     * @param {Gio.Cancellable} cancellable
     * @returns {Promise<GraphQLResult>}
     */
    _sendOnce(queryString, variables, token, cancellable) {
        const uri = GLib.Uri.parse(GITHUB_GRAPHQL_ENDPOINT, GLib.UriFlags.NONE);
        const message = new Soup.Message({
            method: 'POST',
            uri: uri,
        });

        message.request_headers.append('User-Agent', USER_AGENT);
        message.request_headers.append('Authorization', `Bearer ${token.trim()}`);
        message.request_headers.append('Content-Type', 'application/json');
        message.request_headers.append('Accept', 'application/vnd.github.v4+json');

        const payload = JSON.stringify({
            query: queryString,
            variables: variables,
        });
        const encoder = new TextEncoder();
        const bytes = new GLib.Bytes(encoder.encode(payload));
        message.set_request_body_from_bytes('application/json', bytes);

        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (session, res) => {
                    try {
                        const responseBytes = session.send_and_read_finish(res);
                        const decoder = new TextDecoder('utf-8');
                        const responseText = responseBytes ? decoder.decode(responseBytes.get_data()) : '';

                        const retryAfterHeader = message.get_response_headers().get_one('Retry-After');
                        const retryAfterSeconds = /^\d+$/.test(retryAfterHeader)
                            ? parseInt(retryAfterHeader, 10)
                            : null;

                        resolve(parseGraphQLResponse(
                            message.get_status(),
                            message.get_reason_phrase(),
                            responseText,
                            retryAfterSeconds
                        ));
                    } catch (e) {
                        if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            reject(new RequestCancelledError());
                            return;
                        }
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * Executes a GraphQL query against GitHub's API.
     *
     * Transient server errors (HTTP 5xx) are retried with backoff, honoring
     * GitHub's Retry-After header when present.
     *
     * @param {string} queryString
     * @param {Object} variables
     * @param {string|null} overrideToken
     * @param {Gio.Cancellable|null} [sharedCancellable] cancellable owned by
     *   a group of requests (e.g. a full refresh cycle); when given, this
     *   request does not supersede other in-flight requests
     * @returns {Promise<GraphQLResult>}
     */
    async executeQuery(queryString, variables = {}, overrideToken = null, sharedCancellable = null) {
        const token = overrideToken || this._token;
        if (!token) {
            throw new Error('GitHub access token is not configured.');
        }

        let cancellable;
        if (sharedCancellable) {
            cancellable = sharedCancellable;
        } else {
            // Only one self-managed request is in flight at a time; starting a
            // new one cancels the previous. Keep the bookkeeping so a late
            // callback from the superseded request cannot clear the newer
            // request's cancellable.
            this.cancelPending();
            cancellable = new Gio.Cancellable();
            this._cancellable = cancellable;
        }

        try {
            for (let attempt = 0; ; attempt++) {
                if (cancellable.is_cancelled()) {
                    throw new RequestCancelledError();
                }
                try {
                    const result = await this._sendOnce(queryString, variables, token, cancellable);
                    if (cancellable.is_cancelled()) {
                        throw new RequestCancelledError();
                    }
                    return result;
                } catch (e) {
                    if (cancellable.is_cancelled()) {
                        throw new RequestCancelledError();
                    }
                    const transient = e instanceof ApiHttpError &&
                        e.statusCode >= 500 && e.statusCode < 600 &&
                        attempt < MAX_RETRIES;
                    if (!transient) {
                        throw e;
                    }
                    const delay = this._retryDelaySeconds(attempt, e.retryAfterSeconds);
                    console.warn(`[GitHub PR Tracker] HTTP ${e.statusCode} from GitHub, retrying in ${delay}s`);
                    await this._delayRetry(delay, cancellable);
                }
            }
        } finally {
            if (!sharedCancellable && this._cancellable === cancellable) {
                this._cancellable = null;
            }
        }
    }

    /**
     * Verifies a token and retrieves authenticated user information.
     * @param {string} token
     * @returns {Promise<{login: string, name: string, avatarUrl: string}>}
     */
    async verifyToken(token) {
        const { data } = await this.executeQuery(VERIFY_USER_QUERY, {}, token);
        return data.viewer;
    }

    /**
     * Fetches every page of one PR list (bucket).
     *
     * Pages are requested sequentially because each one needs the previous
     * page's cursor. On a page error the pages fetched so far are kept and
     * the error is reported; `fatalError` is only set when not a single page
     * of the bucket could be loaded.
     *
     * @param {string} queryString GraphQL query taking an `$after` cursor
     * @param {string} bucket field name of the search connection in the response
     * @param {Gio.Cancellable} cancellable shared by the whole refresh cycle
     * @returns {Promise<{connection: Object, errors: Array, fatalError: Error|null, viewer: Object|null}>}
     */
    async _fetchBucket(queryString, bucket, cancellable) {
        const nodes = [];
        const errors = [];
        let viewer = null;
        let hasNextPage = false;
        let fatalError = null;
        let cursor = null;

        for (let page = 0; page < MAX_PAGES_PER_BUCKET; page++) {
            try {
                const variables = cursor ? { after: cursor } : {};
                const { data, errors: pageErrors } =
                    await this.executeQuery(queryString, variables, null, cancellable);
                if (data.viewer) {
                    viewer = data.viewer;
                }
                errors.push(...pageErrors);
                const connection = data[bucket];
                if (!connection) {
                    hasNextPage = true;
                    throw new Error(`GitHub did not return the ${bucket} pull request list.`);
                }
                nodes.push(...(connection?.nodes || []).filter(Boolean));
                hasNextPage = !!connection?.pageInfo?.hasNextPage;
                cursor = connection?.pageInfo?.endCursor;
                if (!hasNextPage || !cursor) {
                    break;
                }
            } catch (e) {
                if (e instanceof RequestCancelledError) {
                    throw e;
                }
                if (page === 0) {
                    fatalError = e;
                }
                errors.push({ message: e.message });
                break;
            }
        }

        return {
            connection: { pageInfo: { hasNextPage }, nodes },
            errors,
            fatalError,
            viewer,
        };
    }

    /**
     * Fetches all PR categories and viewer data.
     *
     * The three PR lists are fetched in separate paged requests because
     * resolving them in one query can exceed GitHub's GraphQL execution-time
     * limit. All requests share one cancellable, so a newer refresh cycle
     * supersedes the whole group. A bucket that cannot be loaded at all is
     * reported as a non-fatal error while the other buckets are still
     * returned; only a total failure rejects.
     *
     * @returns {Promise<GraphQLResult>} `errors` lists parts of the response
     *   GitHub could not resolve (e.g. organizations enforcing SAML SSO) or
     *   bucket requests that failed
     */
    async fetchAllPRs() {
        this.cancelPending();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        try {
            const buckets = await Promise.all([
                this._fetchBucket(AUTHORED_PRS_QUERY, 'authored', cancellable),
                this._fetchBucket(REVIEW_REQUESTED_PRS_QUERY, 'reviewRequested', cancellable),
                this._fetchBucket(ASSIGNED_PRS_QUERY, 'assigned', cancellable),
            ]);

            const data = {};
            const errors = [];
            let firstFatalError = null;

            for (const bucket of buckets) {
                if (bucket.fatalError && firstFatalError === null) {
                    firstFatalError = bucket.fatalError;
                }
                errors.push(...bucket.errors);
            }

            if (firstFatalError !== null && buckets.every(bucket => bucket.fatalError !== null)) {
                throw firstFatalError;
            }

            data.authored = buckets[0].connection;
            data.reviewRequested = buckets[1].connection;
            data.assigned = buckets[2].connection;
            const identity = buckets.find(bucket => bucket.viewer !== null);
            if (identity) {
                data.viewer = identity.viewer;
            }

            return { data, errors };
        } finally {
            if (this._cancellable === cancellable) {
                this._cancellable = null;
            }
        }
    }
}
