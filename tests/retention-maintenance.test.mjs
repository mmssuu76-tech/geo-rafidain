import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// PHV1-FIX-011: fail CI if a future refactor makes non-dry-run cleanup reachable.
// This intentionally asserts the deployed maintenance contract verbatim.
const source = readFileSync(new URL('../supabase/functions/retention-cleanup/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const assignment = "  const dryRun = new URL(request.url).searchParams.getAll('dry_run').includes('1')";
const guard = "  if (!dryRun) return json({ error: 'retention_maintenance' }, 503)";
const firstQuery = '  let query = admin';
const newline = String.fromCharCode(10);

function assertMaintenanceProtected(code) {
  const handlerAt = code.indexOf('Deno.serve(async (request) => {');
  const assignmentAt = code.indexOf(assignment);
  const guardAt = code.indexOf(guard);
  const queryAt = code.indexOf(firstQuery);

  assert.ok(handlerAt >= 0, 'request handler must exist');
  assert.ok(assignmentAt > handlerAt, 'expected dry-run mode detection missing');
  assert.ok(guardAt > assignmentAt, 'the 503 maintenance block is missing');
  assert.equal(code.indexOf(guard, guardAt + guard.length), -1, 'duplicate guard');
  assert.ok(queryAt > guardAt, 'maintenance guard must precede the database read');
  assert.equal(
    code.slice(assignmentAt, queryAt),
    `${assignment}\n${guard}\n`,
    'maintenance guard must run immediately after dry-run mode detection',
  );
  assert.doesNotMatch(
    code.slice(handlerAt, guardAt),
    /\bawait\b|\.rpc\s*\(|\.remove\s*\(|\.delete\s*\(|\.insert\s*\(|\.update\s*\(/,
    'no asynchronous or mutating calls may precede the guard',
  );
  for (const operation of [
    "admin.rpc('claim_retention_request'",
    "admin.rpc('finish_retention_request'",
    'admin.storage.from(',
  ]) {
    const position = code.indexOf(operation);
    assert.ok(position > guardAt, `sensitive operation must follow the guard: ${operation}`);
  }
}

test('retention cleanup cannot proceed without dry_run=1', () => {
  assertMaintenanceProtected(source);
});

test('CI rejects accidental removal of maintenance block', () => {
  assert.throws(() => assertMaintenanceProtected(source.replace(guard, '')), /maintenance block/);
});

test('CI rejects moving maintenance block after first query', () => {
  const queryRead = '  const { data: requests, error: readError } = await query';
  const altered = source.replace(guard + newline, '').replace(queryRead, queryRead + newline + guard);
  assert.throws(() => assertMaintenanceProtected(altered), /maintenance guard must precede the database read/);
});

test('CI rejects weakening the maintenance HTTP status', () => {
  assert.throws(() => assertMaintenanceProtected(source.replace(guard, guard.replace('503', '200'))), /maintenance block/);
});

test('CI rejects network activity before the maintenance block', () => {
  const altered = source.replace(guard, `  await admin.rpc('claim_retention_request', {})\n${guard}`);
  assert.throws(() => assertMaintenanceProtected(altered), /maintenance guard must run immediately/);
});
