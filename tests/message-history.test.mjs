import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('conversation pagination keeps equal timestamps stable across a new arrival', async () => {
  const timestamp = '2026-01-01T12:00:00.123456+00:00';
  const row = n => ({ id: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), created_at: timestamp });
  const rows = Array.from({ length: 405 }, (_, i) => row(i));
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'viewer' } } }) },
    from(table) {
      assert.equal(table, 'request_messages');
      const orders = [];
      let before;
      return {
        select() { return this; },
        eq(key, value) { assert.equal(key, 'request_id'); assert.equal(value, 'request'); return this; },
        order(key, { ascending }) { assert.equal(ascending, false); orders.push(key); return this; },
        or(filter) {
          before = filter.match(/id\.lt\.([a-f0-9-]+)\)$/)[1];
          assert.equal(filter, 'created_at.lt.' + timestamp + ',and(created_at.eq.' + timestamp + ',id.lt.' + before + ')');
          return this;
        },
        limit(limit) {
          assert.deepEqual(orders, ['created_at', 'id']);
          return { data: rows.filter(r => !before || r.id < before).reverse().slice(0, limit) };
        }
      };
    }
  };
  const window = { location: { protocol: 'https:' }, supabase: { createClient: () => client },
    GEO_RAFIDAIN_CONFIG: { supabaseUrl: 'https://stage.supabase.co', publishableKey: 'sb_publishable_test' } };
  vm.runInNewContext(await readFile(new URL('../backend.js', import.meta.url), 'utf8'), { window });
  const list = before => window.geoBackend.listRequestMessages('request', before);
  const latest = await list();
  assert.equal(latest.hasOlder, true);
  assert.equal(latest.messages.at(-1).id, row(404).id);
  rows.push(row(405));
  const middle = await list(latest.messages[0]);
  assert.equal(middle.hasOlder, true);
  const first = await list(middle.messages[0]);
  assert.equal(first.hasOlder, false);
  assert.deepEqual([...first.messages, ...middle.messages, ...latest.messages], rows.slice(0, 405));
  assert.equal((await list()).messages.at(-1).id, row(405).id);
});
