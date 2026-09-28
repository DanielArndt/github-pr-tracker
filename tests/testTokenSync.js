// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import { syncClientToken } from '../src/api/tokenSync.js';

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

class FakeClient {
    constructor(token = null) {
        this.token = token;
    }

    setToken(token) {
        this.token = token;
    }
}

const loaderFor = value => () => Promise.resolve(value);

console.log('--- Testing Token Sync ---');

{
    const client = new FakeClient();
    const ok = await syncClientToken(client, loaderFor('ghp_first'));
    assert(ok, 'Returns true when keyring has a token');
    assert(client.token === 'ghp_first', 'Applies token from keyring');
}

{
    const client = new FakeClient('ghp_old');
    const ok = await syncClientToken(client, loaderFor('ghp_new'));
    assert(ok && client.token === 'ghp_new', 'Replaces token already held in memory');
}

{
    const client = new FakeClient('ghp_old');
    const ok = await syncClientToken(client, loaderFor(null));
    assert(!ok, 'Returns false when token was cleared from keyring');
    assert(client.token === null, 'Drops in-memory token when keyring is empty');
}

{
    const client = new FakeClient('ghp_old');
    const ok = await syncClientToken(client, loaderFor('   '));
    assert(!ok && client.token === null, 'Treats whitespace-only token as missing');
}

{
    const client = new FakeClient();
    await syncClientToken(client, loaderFor('  ghp_padded \n'));
    assert(client.token === 'ghp_padded', 'Trims surrounding whitespace');
}

{
    const client = new FakeClient('ghp_old');
    let threw = false;
    try {
        await syncClientToken(client, () => Promise.reject(new Error('keyring locked')));
    } catch (e) {
        threw = e.message === 'keyring locked';
    }
    assert(threw, 'Propagates keyring errors');
    assert(client.token === 'ghp_old', 'Leaves token untouched on keyring error');
}

console.log(`\nToken Sync Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
