// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FETCH_ALL_PRS_QUERY, VERIFY_USER_QUERY } from './queries.js';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'GNOME-Shell-GitHub-PR-Tracker/1.0';

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
 * @returns {GraphQLResult}
 * @throws {Error} on HTTP errors, invalid JSON or responses without data
 */
export function parseGraphQLResponse(statusCode, reasonPhrase, responseText) {
    if (statusCode === 401) {
        throw new Error('Authentication failed (401). Please verify your GitHub Personal Access Token.');
    }

    if (statusCode === 403) {
        throw new Error('GitHub API rate limit exceeded or access forbidden (403).');
    }

    if (statusCode < 200 || statusCode >= 300) {
        throw new Error(`GitHub API error HTTP ${statusCode}: ${reasonPhrase || responseText}`);
    }

    let body;
    try {
        body = JSON.parse(responseText);
    } catch (parseErr) {
        throw new Error(`Failed to parse GitHub response: ${parseErr.message}`);
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
    }

    setToken(token) {
        this._token = token;
    }

    cancelPending() {
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
     * Executes a GraphQL query against GitHub's API.
     * @param {string} queryString
     * @param {Object} variables
     * @param {string|null} overrideToken
     * @returns {Promise<GraphQLResult>}
     */
    async executeQuery(queryString, variables = {}, overrideToken = null) {
        const token = overrideToken || this._token;
        if (!token) {
            throw new Error('GitHub access token is not configured.');
        }

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

        // Only one request is in flight at a time; starting a new one cancels
        // the previous. Keep a local reference so a late callback from the
        // superseded request cannot clear the newer request's cancellable.
        this.cancelPending();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

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

                        resolve(parseGraphQLResponse(
                            message.get_status(),
                            message.get_reason_phrase(),
                            responseText
                        ));
                    } catch (e) {
                        if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            reject(new RequestCancelledError());
                            return;
                        }
                        reject(e);
                    } finally {
                        if (this._cancellable === cancellable) {
                            this._cancellable = null;
                        }
                    }
                }
            );
        });
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
     * Fetches all PR categories and viewer data.
     * @returns {Promise<GraphQLResult>} `errors` lists parts of the response
     *   GitHub could not resolve (e.g. organizations enforcing SAML SSO)
     */
    async fetchAllPRs() {
        return await this.executeQuery(FETCH_ALL_PRS_QUERY);
    }
}
