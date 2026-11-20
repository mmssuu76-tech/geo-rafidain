import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Supply the platform-owned objects used by the application's SQL.
test('storage paths enforce request ownership and MFA, including registration RPC', async () => {
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
    // Synthetic platform fixture: real app RLS/RPCs, mocked storage objects.
    await db.exec('grant select, insert, delete on storage.objects to authenticated');
    const [a,b,admin] = ['1','2','3'].map(n => '00000000-0000-4000-8000-00000000000' + n);
    for (const id of [a,b,admin]) await db.query('insert into auth.users values ($1,$2)', [id,id+'@example.test']);
    await db.query("update public.profiles set role='admin' where id=$1", [admin]);
    await db.query("insert into auth.mfa_factors values ($1,'verified')", [admin]);
    const asUser = async (id,aal='aal1') => {
      await db.exec('reset role; set role authenticated');
      await db.query("select set_config('test.uid',$1,false),set_config('test.aal',$2,false)", [id,aal]);
    };
    const newRequest = async id => {
      await asUser(id);
      return (await db.query("insert into public.service_requests(user_id,name,contact,service,description) values ($1,'client','example','maps','synthetic request for storage test') returning id", [id])).rows[0].id;
    };
    const ra = await newRequest(a), rb = await newRequest(b);
    const fileA = `${a}/${ra}/sample.gpkg`, fileB = `${b}/${rb}/sample.gpkg`;
    const deliveryA = `${a}/${ra}/result.zip`, deliveryB = `${b}/${rb}/result.zip`;
    const insert = (bucket,path) => db.query('insert into storage.objects values (gen_random_uuid(),$1,$2)', [bucket,path]);
    const read = async () => (await db.query('select bucket_id,name from storage.objects order by bucket_id,name')).rows;
    const remove = async (bucket,path) => (await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name', [bucket,path])).rows;
    const register = (id,path,mime='application/zip') => db.query(
      "select public.admin_register_request_deliverable($1,$2,'result.zip',100,$3,'v1',null)", [id,path,mime]);
    const denied = (code,message) => e => e?.code === code && (!message || e.message.includes(message));
    const malformed = [`${a}/${ra}/nested/result.zip`,`${a}/${ra}/../result.zip`,`${a}/${ra}/.hidden.zip`,`${a}/invalid/result.zip`,`${b}/${ra}/result.zip`,`${a}/${ra}/result.exe`,`${a}/${ra}/`,`${a}/${rb}/result.zip`];

    await asUser(a);
    await insert('request-files',fileA);
    await assert.rejects(insert('request-files',fileB),denied('42501'));
    for (const p of malformed) await assert.rejects(insert('request-files',p),denied('42501'));
    await assert.rejects(insert('request-deliverables',deliveryA),denied('42501'));
    await asUser(b);
    await insert('request-files',fileB);
    assert.deepEqual((await read()).map(r => r.name),[fileB]);
    assert.deepEqual(await remove('request-files',fileA),[]);

    await asUser(admin);
    assert.deepEqual(await read(),[]);
    await assert.rejects(insert('request-deliverables',deliveryA),denied('42501'));
    await assert.rejects(register(ra,deliveryA),denied('42501','ADMIN_MFA_REQUIRED'));
    await asUser(admin,'aal2');
    assert.equal((await read()).length,2);
    for (const p of malformed) await assert.rejects(insert('request-deliverables',p),denied('42501'));
    await assert.rejects(insert('request-files',`${a}/${ra}/admin.zip`),denied('42501'));
    await insert('request-deliverables',deliveryA);
    await insert('request-deliverables',deliveryB);
    await register(ra,deliveryA);
    await register(rb,deliveryB);
    await assert.rejects(register(ra,`${a}/${ra}/absent.zip`),denied('P0002','DELIVERABLE_OBJECT_NOT_FOUND'));
    await assert.rejects(register(ra,deliveryB),denied('22023','INVALID_DELIVERABLE_PATH'));
    await assert.rejects(register(ra,`${a}/${ra}/nullmime.zip`,null),denied('22023','INVALID_DELIVERABLE_TYPE'));

    // Legacy objects inserted by a trusted system must not bypass the stricter RPC/RLS.
    const legacy = `${a}/${ra}/nested/legacy.zip`;
    await db.exec('reset role');
    await insert('request-deliverables',legacy);
    await asUser(admin,'aal2');
    await assert.rejects(register(ra,legacy),denied('22023','INVALID_DELIVERABLE_PATH'));
    assert.equal((await read()).length,4);
    assert.deepEqual(await remove('request-deliverables',legacy),[]);
    await asUser(a);
    assert.deepEqual((await read()).map(r => r.name),[deliveryA,fileA]);
    assert.deepEqual(await remove('request-deliverables',deliveryA),[]);
    assert.deepEqual(await remove('request-files',fileB),[]);
    assert.equal((await db.query('select object_path from public.request_deliverables')).rows[0].object_path,deliveryA);
    await asUser(b);
    assert.deepEqual((await read()).map(r => r.name),[deliveryB,fileB]);

    await db.exec('reset role');
    await db.query('delete from auth.mfa_factors where user_id=$1',[admin]);
    await asUser(admin,'aal2');
    assert.deepEqual(await read(),[]);
    await assert.rejects(insert('request-deliverables',`${a}/${ra}/stale.zip`),denied('42501'));
    assert.deepEqual(await remove('request-files',fileA),[]);
    await db.exec('reset role');
    await db.query("insert into auth.mfa_factors values ($1,'verified')", [admin]);
    await asUser(admin,'aal2');
    // Unregistered upload rollback is permitted for valid, existing request paths.
    const rollback = `${a}/${ra}/rollback.zip`;
    await insert('request-deliverables',rollback);
    assert.equal((await remove('request-deliverables',rollback)).length,1);
    await asUser('');
    assert.deepEqual(await read(),[]);
    await db.exec('reset role; set role anon');
    await assert.rejects(read(),denied('42501'));
    await assert.rejects(register(ra,deliveryA),denied('42501'));
  } finally { await db.close(); }
});
