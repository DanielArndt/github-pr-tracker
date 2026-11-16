// SPDX-FileCopyrightText: 2026 Daniel Arndt <dan@arndt.ca>
// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';

const [, contents] = GLib.file_get_contents('.github/workflows/conventional-commits.yml');
const workflow = new TextDecoder().decode(contents);

function assert(condition, name) {
    if (!condition)
        throw new Error(name);
    console.log(`  ✓ PASS: ${name}`);
}

assert(/^ {2}pull_request:$/m.test(workflow), 'Title validation uses pull_request');
assert(/^permissions: \{\}$/m.test(workflow), 'Title validation grants no token permissions');
assert(!/secrets\.|github\.token|uses:|pull_request_target/.test(workflow), 'No secrets, external actions, or checkout');
for (const event of ['opened', 'edited', 'synchronize', 'reopened', 'ready_for_review'])
    assert(workflow.includes(`      - ${event}\n`), `Runs on ${event}`);
assert(workflow.includes('PR_TITLE: ${{ github.event.pull_request.title }}'), 'Title is passed as environment data');

const runBlock = workflow.match(/^ {8}run: \|\n((?: {10}.*\n|\n)+)/m);
assert(runBlock !== null, 'Workflow contains an inline validator');
const script = runBlock[1].replace(/^ {10}/gm, '');
assert(!script.includes('${{'), 'Shell script contains no expression interpolation');

function validate(title) {
    const environment = GLib.get_environ().filter(value => !value.startsWith('PR_TITLE='));
    environment.push(`PR_TITLE=${title}`);
    const [, , , status] = GLib.spawn_sync(null, ['bash', '-e', '-c', script], environment, GLib.SpawnFlags.SEARCH_PATH, null);
    return status === 0;
}

for (const type of ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'])
    assert(validate(`${type}: update behavior`), `Accepts ${type}`);
for (const title of ['fix(classifier): show relevant status badges on draft PRs', 'feat!: change behavior',
    'feat(api)!: change behavior', 'fix: x', 'docs: document café'])
    assert(validate(title), `Accepts valid title: ${title}`);
for (const title of ['', 'update behavior', 'unknown: update behavior', 'fix: Update behavior', 'fix: update behavior.',
    'fix: ', 'fix(): update behavior', 'fix: first\nsecond', 'fix: first\rsecond'])
    assert(!validate(title), 'Rejects malformed title');

// Expansion-like text must remain data, not commands, even in a valid subject.
assert(validate('fix: $(exit 99) `exit 99` "quoted"; exit 99'), 'Shell metacharacters remain literal data');
console.log('PR title workflow tests passed.');
