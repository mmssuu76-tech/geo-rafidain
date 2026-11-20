import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('cache contains only declared app assets and only removes older app caches', async () => {
  const listeners = {};
  const deleted = [];
  const cached = [];
  const scope = 'https://example.test/geo-rafidain/';
  const cache = { put: async url => cached.push(url) };
  const context = {
    URL, self: { registration: { scope }, clients: { claim() {} }, addEventListener: (k, f) => { listeners[k] = f; } },
    caches: { open: async () => cache, keys: async () => ['other-site', 'geo-rafidain-static-v22'], delete: async k => deleted.push(k) },
    fetch: async () => ({ ok: true, type: 'basic', clone: () => ({}) })
  };
  vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let pending;
  listeners.activate({ waitUntil(p) { pending = p; } });
  await pending;
  assert.deepEqual(deleted, ['geo-rafidain-static-v22']);
  for (const path of ['index.html?code=sample', 'dashboard.html?project=sample', 'download.json', '../other.js', 'dashboard.js?v=a&other=b']) {
    listeners.fetch({ request: { method: 'GET', url: new URL(path, scope).href }, respondWith() { assert.fail('should pass through'); } });
  }
  listeners.fetch({ request: { method: 'GET', url: scope + 'dashboard.js?v=test' }, respondWith(p) { pending = p; } });
  await pending;
  assert.deepEqual(cached, [scope + 'dashboard.js']);
});
