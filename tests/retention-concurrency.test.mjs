import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// This fixture uses real locks in an empty dedicated local database.
const connectionString = process.env.RETENTION_TEST_DATABASE;
test('retention serializes reopen, uploads and competing workers and resumes partial cleanup',
  { skip: !connectionString, timeout: 25000 }, async () => {
    const url = new URL(connectionString);
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.pathname, '/retention_ci');
    const pool = new pg.Pool({ connectionString });
    const a = await pool.connect(), b = await pool.connect();
    const id = randomUUID(), owner = randomUUID();
    const claim = async c => (await c.query('select public.claim_retention_request($1) as item', [id])).rows[0].item;
    const finish = async token => (await a.query('select public.finish_retention_request($1,$2) as ok', [id,token])).rows[0].ok;
    const waitForLock = async () => {
      for (let tries = 0; tries < 100; tries++) {
        const r = await a.query('select $1::int = any(pg_blocking_pids($2)) as blocked', [a.processID,b.processID]);
        if (r.rows[0].blocked) return;
        await delay(20);
      }
      assert.fail('second connection did not block on first connection');
    };
    try {
      await a.query(`create role authenticated; create role anon; create role service_role;
        create schema private; create schema storage;
        create table public.service_requests(id uuid primary key,user_id uuid,status text,completed_at timestamptz);
        create table public.request_files(request_id uuid references public.service_requests on delete cascade,object_path text);
        create table public.request_deliverables(like public.request_files);
        create table storage.objects(bucket_id text,name text,owner_id text);
        alter table storage.objects enable row level security;
        grant usage on schema private,storage to authenticated;
        grant insert on storage.objects to authenticated;
        create policy fixture_upload on storage.objects for insert to authenticated with check(true);`);
      await a.query(await readFile(new URL('../ops/applied-migrations/20261120234235_phv1_retention_atomic_claim.sql', import.meta.url), 'utf8'));
      await a.query("insert into public.service_requests values ($1,$2,'completed',now()-interval '91 days',null,null)", [id,owner]);
      await a.query('begin');
      await a.query("update public.service_requests set status='reviewing' where id=$1",[id]);
      const afterReopen = claim(b);
      await waitForLock(); await a.query('commit');
      assert.equal(await afterReopen, null);
      await a.query("update public.service_requests set status='completed',completed_at=now()-interval '91 days'");
      // A previously started upload must commit before the claim snapshots the bucket.
      const path = owner+'/'+id+'/sample.csv';
      await a.query("insert into storage.objects(bucket_id,name) values ('request-deliverables',$1)",[path]);
      await a.query('begin; set local role authenticated');
      await a.query("insert into storage.objects(bucket_id,name) values ('request-files',$1)",[path]);
      const afterUpload = claim(b);
      await waitForLock(); await a.query('commit');
      const first = await afterUpload;
      assert.equal(first.request_files[0].object_path,path);
      assert.equal(await claim(a),null);
      await assert.rejects(b.query("update public.service_requests set status='reviewing'"), /RETENTION_IN_PROGRESS/);
      await assert.rejects(b.query('insert into public.request_deliverables values ($1,$2)',[id,path]), /RETENTION_IN_PROGRESS/);
      await b.query('set role authenticated');
      await assert.rejects(b.query("insert into storage.objects(bucket_id,name) values ('request-files',$1)",[path]), e=>e.code==='42501');
      await b.query('reset role');
      // Delivery removal succeeds but the next bucket still contains its object.
      await a.query("delete from storage.objects where bucket_id='request-deliverables' and name=$1",[path]);
      assert.equal(await finish(first.token),false);
      await a.query("update public.service_requests set retention_lease_until=now()-interval '1 minute'");
      await a.query('begin');
      const retry = await claim(a);
      const competing = claim(b);
      await waitForLock(); await a.query('commit');
      assert.equal(await competing,null);
      assert.notEqual(retry.token,first.token);
      assert.equal(retry.request_deliverables.length,0);
      assert.equal(retry.request_files.length,1);
      assert.equal(await finish(first.token),false);
      await a.query("delete from storage.objects where bucket_id='request-files' and name=$1",[path]);
      assert.equal(await finish(retry.token),true);
      assert.equal(await finish(retry.token),false);
    } finally {
      await a.query('rollback'); await b.query('rollback');
      a.release(); b.release(); await pool.end();
    }
  });
