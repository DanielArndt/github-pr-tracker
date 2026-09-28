// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
GLib.setenv('GSETTINGS_BACKEND', 'memory', true);

import { syncClientToken, notifyTokenChanged, TOKEN_CHANGED_KEY } from '../src/api/tokenSync.js';

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

// notifyTokenChanged bumps the GSettings marker that the extension listens to
{
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        './schemas',
        Gio.SettingsSchemaSource.get_default(),
        false
    );
    const schema = schemaSource.lookup('org.gnome.shell.extensions.github-pr-tracker', false);
    const settings = new Gio.Settings({ settings_schema: schema });

    assert(settings.get_int64(TOKEN_CHANGED_KEY) === 0, 'token-changed defaults to 0');

    let changedCount = 0;
    const id = settings.connect(`changed::${TOKEN_CHANGED_KEY}`, () => changedCount++);

    notifyTokenChanged(settings);
    const first = settings.get_int64(TOKEN_CHANGED_KEY);
    assert(first > 0, 'notifyTokenChanged writes a timestamp');

    GLib.usleep(1000);
    notifyTokenChanged(settings);
    assert(settings.get_int64(TOKEN_CHANGED_KEY) > first, 'Repeated notifications change the value');
    assert(changedCount === 2, 'Each notification emits a changed signal');

    settings.disconnect(id);
    settings.reset(TOKEN_CHANGED_KEY);
}

console.log(`\nToken Sync Tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
}
