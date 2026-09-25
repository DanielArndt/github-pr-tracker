// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Soup from 'gi://Soup?version=3.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FETCH_ALL_PRS_QUERY, VERIFY_USER_QUERY } from './queries.js';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const USER_AGENT = 'GNOME-Shell-GitHub-PR-Tracker/1.0';

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

    hasToken() {
        return !!this._token && this._token.trim().length > 0;
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
     * @returns {Promise<any>}
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

        this.cancelPending();
        this._cancellable = new Gio.Cancellable();

        return new Promise((resolve, reject) => {
            this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this._cancellable,
                (session, res) => {
                    try {
                        const responseBytes = session.send_and_read_finish(res);
                        const statusCode = message.get_status();

                        const decoder = new TextDecoder('utf-8');
                        const responseText = responseBytes ? decoder.decode(responseBytes.get_data()) : '';

                        if (statusCode === 401) {
                            reject(new Error('Authentication failed (401). Please verify your GitHub Personal Access Token.'));
                            return;
                        }

                        if (statusCode === 403) {
                            reject(new Error('GitHub API rate limit exceeded or access forbidden (403).'));
                            return;
                        }

                        if (statusCode < 200 || statusCode >= 300) {
                            reject(new Error(`GitHub API error HTTP ${statusCode}: ${message.get_reason_phrase() || responseText}`));
                            return;
                        }

                        let data;
                        try {
                            data = JSON.parse(responseText);
                        } catch (parseErr) {
                            reject(new Error(`Failed to parse GitHub response: ${parseErr.message}`));
                            return;
                        }

                        if (data.errors && data.errors.length > 0) {
                            const errorMsg = data.errors.map(e => e.message).join('; ');
                            reject(new Error(`GraphQL error: ${errorMsg}`));
                            return;
                        }

                        resolve(data.data);
                    } catch (e) {
                        if (e.matches && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            // Request cancelled quietly
                            return;
                        }
                        reject(e);
                    } finally {
                        this._cancellable = null;
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
        const data = await this.executeQuery(VERIFY_USER_QUERY, {}, token);
        return data.viewer;
    }

    /**
     * Fetches all PR categories and viewer data.
     * @returns {Promise<any>}
     */
    async fetchAllPRs() {
        return await this.executeQuery(FETCH_ALL_PRS_QUERY);
    }
}
