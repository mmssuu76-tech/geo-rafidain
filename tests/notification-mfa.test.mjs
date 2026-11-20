import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Supply the platform-owned objects used by the application's SQL.
test('notification RLS and mark-read RPC require MFA, recipient and request ownership', async () => {
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
    // The mock contains synthetic accounts only. Use real application policies/RPCs.
    const [a, b, admin] = ['1','2','3'].map(n => '00000000-0000-4000-8000-00000000000' + n);
    for (const id of [a, b, admin]) {
      await db.query('insert into auth.users values ($1,$2)', [id, id + '@example.test']);
    }
    await db.query("update public.profiles set role='admin' where id=$1", [admin]);
    const asUser = async (id, aal='aal1') => {
      await db.exec('reset role; set role authenticated');
      await db.query("select set_config('test.uid',$1,false), set_config('test.aal',$2,false)", [id, aal]);
    };
    const notes = async () => (await db.query(
      'select id, user_id, request_id, body, read_at from public.user_notifications order by body, id'
    )).rows;
    const mark = async (id=null) => (await db.query(
      'select public.mark_notifications_read($1::uuid) as count', [id]
    )).rows[0].count;
    const denied = (code, message) => error => error?.code === code && (!message || error.message.includes(message));
    const newRequest = async id => {
      await asUser(id);
      return (await db.query(
        "insert into public.service_requests(user_id,name,contact,service,description) values ($1,'client','example','maps','synthetic request for notification test') returning id", [id]
      )).rows[0].id;
    };
    const send = (requestId, body) => db.query('select public.send_request_message($1,$2)', [requestId, body]);
    const ra = await newRequest(a);
    const rb = await newRequest(b);
    await asUser(a);
    await send(ra, 'synthetic admin note A');
    assert.equal((await notes()).length, 0);
    await asUser(b);
    await send(rb, 'synthetic admin note B');
    assert.equal((await notes()).length, 0);

    // Admin AAL1: even with a verified factor, the current session is insufficient.
    await db.exec('reset role');
    await db.query("insert into auth.mfa_factors values ($1,'verified')", [admin]);
    await asUser(admin);
    assert.deepEqual(await notes(), []);
    await assert.rejects(mark(), denied('42501', 'ADMIN_MFA_REQUIRED'));

    // Admin AAL2 sees only their own notifications, not arbitrary recipients.
    await asUser(admin, 'aal2');
    const adminNotes = await notes();
    assert.equal(adminNotes.length, 2);
    assert.ok(adminNotes.every(n => n.user_id === admin && n.read_at === null));
    await send(ra, 'synthetic reply A');
    await send(rb, 'synthetic reply B');
    assert.equal((await notes()).length, 2);
    assert.equal(await mark(adminNotes[0].id), 1);
    assert.equal((await notes()).filter(n => n.read_at !== null).length, 1);

    // Clients remain isolated, even if they know another notification's UUID.
    await asUser(a);
    const aNotes = await notes();
    assert.equal(aNotes.length, 1);
    assert.equal(aNotes[0].body, 'synthetic reply A');
    assert.equal(aNotes[0].request_id, ra);
    await asUser(b);
    const bNotes = await notes();
    assert.equal(bNotes.length, 1);
    assert.equal(bNotes[0].body, 'synthetic reply B');
    assert.equal(bNotes[0].request_id, rb);
    assert.equal(await mark(aNotes[0].id), 0);
    assert.equal(await mark(adminNotes[0].id), 0);
    await asUser(a);
    assert.equal(await mark(bNotes[0].id), 0);
    assert.equal(await mark(), 1);
    assert.ok((await notes())[0].read_at !== null);
    await asUser(b);
    assert.equal((await notes())[0].read_at, null);

    // AAL2 without a currently verified factor must fail, even using an old JWT.
    await db.exec('reset role');
    await db.query('delete from auth.mfa_factors where user_id=$1', [admin]);
    await asUser(admin, 'aal2');
    assert.deepEqual(await notes(), []);
    await assert.rejects(mark(adminNotes[1].id), denied('42501', 'ADMIN_MFA_REQUIRED'));
    await assert.rejects(mark(), denied('42501', 'ADMIN_MFA_REQUIRED'));

    // Historical notifications must not leak after demotion or with no request.
    await db.exec('reset role');
    await db.query("update public.profiles set role='client' where id=$1", [admin]);
    await db.query("insert into public.user_notifications(user_id,request_id,notification_type,title,body) values ($1,null,'message','Synthetic','synthetic request-less note'),($1,$2,'message','Synthetic','synthetic mismatched ownership note')", [a, rb]);
    await asUser(admin, 'aal2');
    assert.deepEqual(await notes(), []);
    assert.equal(await mark(adminNotes[1].id), 0);
    assert.equal(await mark(), 0);
    await asUser(a);
    assert.equal((await notes()).length, 1);
    assert.equal(await mark(), 1);
    await db.exec('reset role');
    const hidden = (await db.query("select read_at from public.user_notifications where body in ('synthetic request-less note','synthetic mismatched ownership note','synthetic admin note B','synthetic reply B')")).rows;
    assert.equal(hidden.length, 4);
    assert.ok(hidden.every(n => n.read_at === null));

    await asUser('');
    assert.deepEqual(await notes(), []);
    await assert.rejects(mark(), denied('42501', 'AUTH_REQUIRED'));
    await db.exec('reset role; set role anon');
    await assert.rejects(notes(), denied('42501'));
    await assert.rejects(mark(), denied('42501'));
  } finally { await db.close(); }
});
