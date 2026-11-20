import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validRequestPaths } from '../supabase/functions/_shared/request-paths.mjs';

const owner = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';
const path = owner + '/' + id + '/sample.gpkg';

test('both collections must belong to the same owner and request', () => {
  const req = { user_id: owner, id, request_files: [], request_deliverables: [] };
  assert.ok(validRequestPaths(req));
  for (const key of ['request_files', 'request_deliverables']) {
    assert.ok(validRequestPaths({ ...req, [key]: [{ object_path: path }] }));
    for (const candidate of [null, id + '/' + id + '/sample.gpkg', owner + '/' + owner + '/sample.gpkg', path + '/child', owner + '/' + id + '/..']) {
      assert.equal(validRequestPaths({ ...req, [key]: [{ object_path: candidate }] }), false);
    }
    assert.equal(validRequestPaths({ ...req, [key]: null }), false);
  }
});

test('database applies session, factor, grants and new attachment constraints', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create schema private;
      create role authenticated; create role anon; create role service_role;
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql as
        $$ select jsonb_build_object('aal',current_setting('test.aal',true)) $$;
      create table auth.mfa_factors (user_id uuid, status text);
      create table public.request_files(owner_id uuid not null, request_id uuid not null, object_path text not null);
    `);
    await db.exec(await readFile(new URL('../supabase/foundation-hardening.sql', import.meta.url), 'utf8'));
    const scalar = async sql => (await db.query(sql)).rows[0].ok;
    const mfa = () => scalar('select private.admin_mfa_ok() as ok');
    assert.equal(await mfa(), false);
    await db.query("select set_config('test.uid',$1,false)", [owner]);
    await db.exec("set test.aal = 'aal2'");
    assert.equal(await mfa(), false);
    await db.query("insert into auth.mfa_factors values ($1,'verified')", [owner]);
    assert.equal(await mfa(), true);
    await db.exec("set test.aal = 'aal1'");
    assert.equal(await mfa(), false);
    assert.equal(await scalar("select has_function_privilege('anon','private.admin_mfa_ok()','EXECUTE') as ok"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated','private.admin_mfa_ok()','EXECUTE') as ok"), true);
    await db.query('insert into public.request_files values ($1,$2,$3)', [owner, id, path]);
    await assert.rejects(db.query('insert into public.request_files values ($1,$2,$3)', [owner,id,id + '/' + id + '/sample.gpkg']), e => e.code === '23514');
  } finally { await db.close(); }
});
