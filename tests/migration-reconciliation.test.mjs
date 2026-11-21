import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const file = path => new URL(path, root);

test('archived applied migrations are distinct from pending SQL and unchanged', async () => {
  const manifest = JSON.parse(await readFile(file('ops/migration-reconciliation.json'), 'utf8'));
  assert.equal(manifest.production_project_ref, 'nrvewrdwmonlzamsvdjm');
  assert.ok(manifest.applied.some(x => x.name === 'phv1_attachment_path_hardening'));
  const names = new Set();
  for (const item of manifest.applied) {
    assert.equal(item.applied_to_production, true);
    assert.match(item.version, /^20\d{12}$/);
    assert.match(item.snapshot_path, /^ops\/applied-migrations\/20\d{12}_[a-z0-9_]+\.sql$/);
    assert.ok(!names.has(item.version));
    names.add(item.version);
    const text = await readFile(file(item.snapshot_path), 'utf8');
    // Windows may check out SQL text with CRLF; validate canonical LF content without altering archived files.
    assert.equal(createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex'), item.sha256);
  }
  const pending = manifest.pending.map(x => x.review_path);
  assert.equal(new Set(pending).size, pending.length);
  for (const name of pending) {
    assert.match(name, /^ops\/pending\/[-a-z0-9]+\.sql$/);
    const sql = await readFile(file(name), 'utf8');
    assert.match(sql, /REVIEW ONLY/i);
    assert.equal(manifest.pending.find(x => x.review_path === name).applied_to_production, false);
  }
});
