import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Synthetic, in-memory SQL integration. This is NOT a live Supabase Auth/Storage HTTP test.
const scripts = [
  'schema', 'security-hardening', 'admin-workflow', 'quote-workflow',
  'gis-file-formats', 'communication-delivery', 'geo-resources',
  'research-workspaces', 'research-project-versions',
  'function-permissions-hardening', 'retention-cleanup-permissions',
  'foundation-hardening',
];
const [clientA, clientB, administrator] = [1, 2, 3]
  .map(n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const hasCode = (code) => (error) => error?.code === code;

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      grant usage on schema auth, storage to authenticated;
      create table auth.users(id uuid primary key, email text);
      create table auth.mfa_factors(user_id uuid, status text);
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql as
        $$ select jsonb_build_object('aal', current_setting('test.aal', true)) $$;
      create table storage.buckets(id text primary key, name text, public boolean,
        file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid, bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql as
        $$ select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1] $$;
      create function storage.extension(text) returns text language sql as
        $$ select split_part($1, '.', -1) $$;
    `);
    for (const name of scripts) {
      try {
        await db.exec(await readFile(new URL(`../supabase/${name}.sql`, import.meta.url), 'utf8'));
      } catch (error) {
        throw new Error(`SEC-012 local bootstrap/${name}: ${error.message}`);
      }
    }
    // The production Storage API enforces additional object privileges and blob rules.
    // Only the SQL row policies are exercised here.
    await db.exec('grant select, insert, delete on storage.objects to authenticated');
    for (const id of [clientA, clientB, administrator]) {
      await db.query('insert into auth.users values ($1, $2)', [id, `${id}@example.test`]);
    }
    await db.query("update public.profiles set role='admin' where id=$1", [administrator]);
    await db.query("insert into auth.mfa_factors values ($1, 'verified')", [administrator]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function identity(db, uid, aal = 'aal1') {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('test.uid', $1, false), set_config('test.aal', $2, false)", [uid, aal]);
}

async function all(db, query, params = []) {
  return (await db.query(query, params)).rows;
}

async function newRequest(db, userId) {
  await identity(db, userId);
  return (await all(db,
    "insert into public.service_requests(user_id, name, contact, service, description) values ($1, 'Synthetic client', 'test@example.test', 'maps', 'Synthetic SEC-012 service journey') returning id",
    [userId]))[0].id;
}

// Intentional single ordered journey: the same synthetic request moves through
// the quote, acceptance, message, upload metadata, delivery and notification flows.
test('SEC-012: distinct clients and MFA-gated admin complete a protected service journey', { timeout: 45000 }, async () => {
  const db = await fixture();
  try {
    const ra = await newRequest(db, clientA);
    const rb = await newRequest(db, clientB);
    const uploadA = `${clientA}/${ra}/input.gpkg`;
    const uploadB = `${clientB}/${rb}/input.gpkg`;
    const deliveryA = `${clientA}/${ra}/result.zip`;
    const storageInsert = (bucket, path) => db.query(
      'insert into storage.objects (id,bucket_id,name) values (gen_random_uuid(),$1,$2)',
      [bucket, path],
    );
    const storageVisible = () => all(db,
      'select bucket_id,name from storage.objects order by bucket_id,name');
    const requestVisible = () => all(db, 'select id from public.service_requests order by id');
    const notices = () => all(db,
      'select id,request_id,user_id,notification_type,read_at from public.user_notifications order by created_at,id');
    const messages = () => all(db,
      'select request_id,sender_role from public.request_messages order by created_at,id');
    const sendQuote = (id) => db.query(
      "select (public.admin_send_service_quote($1, 50000, current_date + 14, 'A full synthetic geospatial map analysis', null)).quote_status as state",
      [id],
    );
    const decideQuote = (id, decision) => db.query(
      'select (public.respond_to_service_quote($1,$2,null)).quote_status as state', [id, decision]);
    const markRead = (id = null) => all(db,
      'select public.mark_notifications_read($1::uuid) as changed', [id]);
    const register = (id, path) => db.query(
      "select public.admin_register_request_deliverable($1,$2,'result.zip',512,'application/zip','v1',null)",
      [id, path]);

    // Two independent clients must not see or write to each other's requests.
    await identity(db, clientA);
    assert.deepEqual((await requestVisible()).map(x => x.id), [ra]);
    await storageInsert('request-files', uploadA);
    await assert.rejects(storageInsert('request-files', uploadB), hasCode('42501'));
    await identity(db, clientB);
    assert.deepEqual((await requestVisible()).map(x => x.id), [rb]);
    await storageInsert('request-files', uploadB);
    assert.deepEqual((await storageVisible()).map(x => x.name), [uploadB]);
    await assert.rejects(decideQuote(ra, 'accepted'), hasCode('42501'));

    // An administrative role alone is not enough: the current session needs AAL2.
    await identity(db, administrator);
    assert.deepEqual(await requestVisible(), []);
    assert.deepEqual(await storageVisible(), []);
    await assert.rejects(sendQuote(ra), hasCode('42501'));
    await assert.rejects(storageInsert('request-deliverables', deliveryA), hasCode('42501'));

    await identity(db, administrator, 'aal2');
    assert.equal((await requestVisible()).length, 2);
    assert.equal((await sendQuote(ra)).rows[0].state, 'pending');
    assert.deepEqual((await all(db,
      'select action from public.request_quote_events where request_id=$1', [ra]
    )).map(x => x.action), ['sent']);

    // Client B cannot accept a quote sent to client A, even with a known UUID.
    await identity(db, clientB);
    assert.deepEqual(await notices(), []);
    await assert.rejects(decideQuote(ra, 'accepted'), hasCode('42501'));
    await identity(db, clientA);
    assert.ok((await notices()).some(x => x.request_id === ra && x.notification_type === 'quote'));
    assert.equal((await decideQuote(ra, 'accepted')).rows[0].state, 'accepted');
    await assert.rejects(decideQuote(ra, 'rejected'), hasCode('42501'));
    assert.deepEqual((await all(db,
      'select action from public.request_quote_events where request_id=$1 order by id', [ra]
    )).map(x => x.action), ['sent', 'accepted']);

    // Customer message creates an admin-only notification; admin reply reaches A only.
    await db.query("select public.send_request_message($1, 'Synthetic customer request details')", [ra]);
    await identity(db, administrator);
    assert.deepEqual(await notices(), []);
    await identity(db, administrator, 'aal2');
    assert.ok((await notices()).some(x => x.request_id === ra && x.notification_type === 'message'));
    await db.query("select public.send_request_message($1, 'Synthetic administrative response')", [ra]);
    assert.equal((await messages()).length, 2);

    // The admin may upload and register only a valid path for the actual owner.
    await storageInsert('request-deliverables', deliveryA);
    await register(ra, deliveryA);
    await assert.rejects(register(rb, deliveryA), hasCode('22023'));
    assert.deepEqual((await all(db,
      'select request_id,object_path from public.request_deliverables'
    )).map(x => x.object_path), [deliveryA]);

    await identity(db, clientB);
    assert.deepEqual(await all(db, 'select id from public.request_deliverables'), []);
    assert.deepEqual(await messages(), []);
    assert.deepEqual((await storageVisible()).map(x => x.name), [uploadB]);
    await assert.rejects(register(ra, deliveryA), hasCode('42501'));
    const bNotices = await notices();
    assert.ok(bNotices.every(x => x.user_id === clientB));
    await identity(db, clientA);
    assert.deepEqual((await all(db,
      'select object_path from public.request_deliverables'
    )).map(x => x.object_path), [deliveryA]);
    assert.equal((await messages()).length, 2);
    assert.deepEqual((await storageVisible()).map(x => x.name).sort(), [uploadA, deliveryA].sort());
    const ownNotice = (await notices()).find(x => x.notification_type === 'delivery');
    assert.equal(ownNotice?.request_id, ra);
    await assert.rejects(register(ra, deliveryA), hasCode('42501'));
    const changed = await markRead(ownNotice.id);
    assert.equal(changed[0].changed, 1);
    await identity(db, clientB);
    assert.equal((await markRead(ownNotice.id))[0].changed, 0);

    // AAL2 JWT without a currently verified MFA factor must be rejected again.
    await db.exec('reset role');
    await db.query('delete from auth.mfa_factors where user_id=$1', [administrator]);
    await identity(db, administrator, 'aal2');
    assert.deepEqual(await requestVisible(), []);
    assert.deepEqual(await storageVisible(), []);
    await assert.rejects(sendQuote(rb), hasCode('42501'));
    await assert.rejects(register(rb, `${clientB}/${rb}/result.zip`), hasCode('42501'));
  } finally {
    await db.close();
  }
});
