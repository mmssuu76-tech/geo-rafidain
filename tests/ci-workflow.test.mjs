import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../.github/workflows/phv1-security-checks.yml', import.meta.url);

test('CI workflow is read-only, uses immutable actions, and executes security tests', async () => {
  const source = await readFile(workflowPath, 'utf8');
  assert.match(source, /^name: PHV1 security checks$/m);
  assert.match(source, /^on:\s*$/m);
  assert.match(source, /^  pull_request:\s*$/m);
  assert.match(source, /^  push:\s*$/m);
  assert.match(source, /hardening\/\*\*/);
  assert.match(source, /^permissions:\s*\n  contents: read$/m);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /npm ci --ignore-scripts/);
  assert.match(source, /node --test --test-reporter=tap tests\/\*\.test\.mjs/);
  assert.match(source, /git merge-base origin\/main HEAD/);
  const actions = [...source.matchAll(/^\s*uses: ([^\s#]+)/gm)].map(x => x[1]);
  assert.equal(actions.length, 2);
  assert.match(actions[0], /^actions\/checkout@[a-f0-9]{40}$/);
  assert.match(actions[1], /^actions\/setup-node@[a-f0-9]{40}$/);
  assert.doesNotMatch(source, /\$\{\{\s*secrets\.|pull_request_target|supabase\s+db\s+push|supabase\s+functions\s+deploy|service.role.key/i);
  assert.doesNotMatch(source, /^\s*(?:contents|actions|id-token|deployments|packages|security-events): write\s*$/m);
});
