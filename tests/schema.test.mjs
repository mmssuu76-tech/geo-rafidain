import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Supply the platform-owned objects used by the application's SQL.
test('fresh schema and ordinary request visibility across client and admin sessions', async () => {
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
    const scripts = ['schema','security-hardening','admin-workflow','quote-workflow','gis-file-formats','communication-delivery',
      'geo-resources','research-workspaces','research-project-versions','function-permissions-hardening','retention-cleanup-permissions','foundation-hardening'];
    for (const name of scripts) {
      const sql = await readFile(new URL('../supabase/' + name + '.sql', import.meta.url), 'utf8');
      try { await db.exec(sql); } catch (error) { throw new Error(name + ': ' + error.message); }
    }
    const inventory = await db.query(await readFile(new URL('../ops/schema-inventory.sql', import.meta.url), 'utf8'));
    const { tables, buckets } = inventory.rows[0].configuration_inventory;
    assert.ok(tables.length > 5 && tables.every(t => t.rls));
    assert.equal(buckets.length, 2);
    assert.ok(buckets.every(b => !b.public));
    const ids = ['1','2','3'].map(n => '00000000-0000-4000-8000-00000000000' + n);
    for (const id of ids) {
      await db.query('insert into auth.users values ($1,$2)', [id, id + '@example.test']);
    }
    await db.query("update public.profiles set role='admin' where id=$1", [ids[2]]);
    await db.exec("set role authenticated; set test.aal='aal1'");
    for (const id of ids.slice(0, 2)) {
      await db.query("select set_config('test.uid',$1,false)", [id]);
      await db.query("insert into public.service_requests(user_id,name,contact,service,description) values ($1,'client','example','maps','synthetic request for schema test')", [id]);
    }
    await db.exec("set role authenticated; set test.aal='aal1'");
    const readAs = async id => {
      await db.query("select set_config('test.uid',$1,false)", [id]);
      return (await db.query('select user_id from public.service_requests order by user_id')).rows.map(r => r.user_id);
    };
    assert.deepEqual(await readAs(ids[0]), [ids[0]]);
    assert.deepEqual(await readAs(ids[1]), [ids[1]]);
    assert.deepEqual(await readAs(ids[2]), []);
    await db.exec('reset role');
    await db.query("insert into auth.mfa_factors values ($1,'verified')", [ids[2]]);
    await db.exec("set role authenticated; set test.aal='aal2'");
    assert.deepEqual(await readAs(ids[2]), ids.slice(0, 2));
  } finally { await db.close(); }
});
