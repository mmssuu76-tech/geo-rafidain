import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { validRequestPaths } from '../supabase/functions/_shared/request-paths.mjs';

const sql = async relative => readFile(new URL('../' + relative, import.meta.url), 'utf8');
const scripts = [
  'schema', 'security-hardening', 'admin-workflow', 'quote-workflow',
  'gis-file-formats', 'communication-delivery', 'geo-resources',
  'research-workspaces', 'research-project-versions',
  'function-permissions-hardening', 'retention-cleanup-permissions',
  'foundation-hardening'
];

async function bootstrap(legacy = false) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      grant usage on schema auth,storage to authenticated;
      create table auth.users(id uuid primary key,email text);
      create table auth.mfa_factors(user_id uuid,status text);
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql as
        $$ select jsonb_build_object('aal',current_setting('test.aal',true)) $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid,bucket_id text,name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as
        $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      create function storage.extension(text) returns text language sql as $$ select split_part($1,'.',-1) $$;
    `);
    for (const name of scripts) {
      const source = name === 'communication-delivery' && legacy
        ? await sql('tests/fixtures/communication-delivery.pre-hardening.sql')
        : await sql('supabase/' + name + '.sql');
      try { await db.exec(source); }
      catch (error) { throw new Error(`bootstrap/${name}: ${error.message}`); }
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function catalog(db) {
  const policies = (await db.query(`
    select schemaname, tablename, policyname, cmd, roles::text,
           qual, with_check
    from pg_policies
    where (schemaname='storage' and tablename='objects'
           and policyname like 'storage_request_%')
       or (schemaname='public' and tablename='user_notifications'
           and policyname='notifications_read_own')
    order by schemaname, tablename, policyname
  `)).rows;
  const defs = [];
  for (const signature of [
    'private.request_storage_path_ok(text)',
    'public.mark_notifications_read(uuid)',
    'public.admin_register_request_deliverable(uuid,text,text,bigint,text,text,text)'
  ]) {
    const result = await db.query('select pg_get_functiondef($1::regprocedure) as source', [signature]);
    defs.push({ signature, source: result.rows[0].source });
  }
  const permissions = (await db.query(`
    select has_function_privilege('authenticated','private.request_storage_path_ok(text)','EXECUTE') as auth_ok,
           has_function_privilege('anon','private.request_storage_path_ok(text)','EXECUTE') as anon_ok
  `)).rows[0];
  return { policies, defs, permissions };
}

test('archived SQL can upgrade a pre-fix schema and matches fresh security definitions', async () => {
  const upgraded = await bootstrap(true);
  let fresh;
  try {
    for (const name of ['20261121203845_phv1_notification_mfa','20261121203937_phv1_attachment_path_hardening']) {
      const source = await sql('ops/applied-migrations/' + name + '.sql');
      assert.match(source, /REVIEW ONLY/);
      try { await upgraded.exec(source); }
      catch (error) { throw new Error(`applied/${name}: ${error.message}`); }
    }
    fresh = await bootstrap(false);
    const fromUpgrade = await catalog(upgraded);
    const fromFresh = await catalog(fresh);
    assert.equal(fromUpgrade.policies.length, 7);
    assert.equal(fromUpgrade.permissions.auth_ok, true);
    assert.equal(fromUpgrade.permissions.anon_ok, false);
    for (const policy of fromUpgrade.policies) {
      if (policy.schemaname === 'storage') {
        assert.match(policy.qual ?? policy.with_check, /request_storage_path_ok/);
      } else {
        assert.match(policy.qual, /admin_mfa_ok/);
      }
    }
    assert.deepEqual(fromUpgrade, fromFresh);
  } finally {
    await upgraded.close();
    if (fresh) await fresh.close();
  }
});

test('upgraded storage helper rejects cross-request and stale-admin access', async () => {
  const db = await bootstrap(true);
  try {
    await db.exec(await sql('ops/applied-migrations/20261121203845_phv1_notification_mfa.sql'));
    await db.exec(await sql('ops/applied-migrations/20261121203937_phv1_attachment_path_hardening.sql'));
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    const admin = '00000000-0000-4000-8000-000000000003';
    for (const id of [a,b,admin]) {
      await db.query('insert into auth.users values ($1,$2)', [id,id+'@example.test']);
    }
    await db.query("update public.profiles set role='admin' where id=$1",[admin]);
    await db.query("insert into auth.mfa_factors values ($1,'verified')",[admin]);
    const asUser = async (id,aal='aal1') => {
      await db.exec('reset role; set role authenticated');
      await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)",[id,aal]);
    };
    await asUser(a);
    const requestId = (await db.query(`
      insert into public.service_requests(user_id,name,contact,service,description)
      values ($1,'client','example','maps','synthetic isolated request for staged migration verification')
      returning id
    `,[a])).rows[0].id;
    const own = `${a}/${requestId}/valid.gpkg`;
    const stolen = `${b}/${requestId}/valid.gpkg`;
    const good = name => db.query('select private.request_storage_path_ok($1) as allowed',[name])
      .then(result => result.rows[0].allowed);
    assert.equal(await good(own),true);
    assert.equal(await good(stolen),false);
    for (const bad of [own+'/child',own.replace('valid.gpkg','..'),
                       own.replace('valid.gpkg','.hidden.gpkg'),
                       own.replace('valid.gpkg','valid.gpkg?token=1')]) {
      assert.equal(await good(bad),false);
    }
    await asUser(b);
    assert.equal(await good(own),false);
    await asUser(admin);
    assert.equal(await good(own),false);
    await asUser(admin,'aal2');
    assert.equal(await good(own),true);
    await db.exec('reset role');
    await db.query('delete from auth.mfa_factors where user_id=$1',[admin]);
    await asUser(admin,'aal2');
    assert.equal(await good(own),false);
  } finally {
    await db.close();
  }
});

test('privileged request-path validator rejects malformed and mixed-tenant collections', () => {
  const owner = '00000000-0000-4000-8000-000000000001';
  const id = '00000000-0000-4000-8000-000000000002';
  const valid = { user_id: owner, id, request_files: [], request_deliverables: [] };
  const good = `${owner}/${id}/valid.gpkg`;
  assert.equal(validRequestPaths(valid),true);
  for (const collection of ['request_files','request_deliverables']) {
    assert.equal(validRequestPaths({ ...valid, [collection]: [{object_path:good}] }),true);
    for (const tail of [
      '../valid.gpkg', '.hidden.gpkg', 'nested/valid.gpkg',
      'valid.gpkg?x=1','valid.gpkg#f','valid%2fgpkg',
      'valid\\gpkg', 'ملف.gpkg', 'valid.gpkg\n',
      'valid.gpkg\u0000', 'valid.gpkg ', '', '/valid.gpkg'
    ]) {
      const path = `${owner}/${id}/${tail}`;
      assert.equal(validRequestPaths({ ...valid, [collection]: [{object_path:path}] }),false,
                   `accepted malformed path: ${JSON.stringify(path)}`);
    }
    for (const row of [null,{}, { object_path: null }, { object_path: 42 },
                       { object_path:`${owner}/${owner}/valid.gpkg` },
                       { object_path:`${id}/${id}/valid.gpkg` }]) {
      assert.equal(validRequestPaths({ ...valid, [collection]: [row] }),false);
    }
    assert.equal(validRequestPaths({ ...valid, [collection]: null }),false);
  }
  assert.equal(validRequestPaths({ ...valid, user_id:null }),false);
  assert.equal(validRequestPaths({ ...valid, id:null }),false);
});
