import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const source = readFileSync(new URL('../backend.js', import.meta.url), 'utf8');

for (const fault of ['request-after','input-before','input-after','metadata-after','delivery-after','registration-after']) {
  test('resume the same operation after loss at ' + fault, async () => {
    const rows = { service_requests: [], request_files: [], request_deliverables: [], profiles: [{id:'actor', role:'admin'}] };
    const objects = new Map();
    const sessionStorage = new Map();
    let offline = false;
    let inject = true;
    const reply = (stage, data) => {
      if (inject && stage === fault) offline = true;
      return offline ? {error:new Error('offline')} : {data};
    };
    const client = {
      auth:{getUser:async () => ({data:{user:{id:'actor'}}})},
      from(table) {
        return {
          select:() => ({eq:(key,value) => {
            const read = () => reply('read',rows[table].find(row => row[key] === value) || null);
            return {single:read, maybeSingle:read};
          }}),
          insert(row) {
            assert.ok(!offline);
            rows[table].push(row);
            return table === 'service_requests'
              ? {select:() => ({single:() => reply('request-after',row)})}
              : reply('metadata-after',row);
          }
        };
      },
      storage:{from:bucket => ({
        upload(path,file) {
          if (bucket === 'request-files' && reply('input-before').error) return reply('read');
          if (objects.has(path)) return {error:new Error('duplicate')};
          objects.set(path,file);
          return reply(bucket === 'request-files' ? 'input-after' : 'delivery-after');
        },
        download:path => reply('read',objects.get(path))
      })},
      rpc(_name,params) {
        const row = {object_path:params.p_object_path};
        rows.request_deliverables.push(row);
        return reply('registration-after',row);
      }
    };
    const window = {location:{protocol:'https:'},supabase:{createClient:() => client},
      GEO_RAFIDAIN_CONFIG:{supabaseUrl:'https://stage.supabase.co',publishableKey:'sb_publishable_test'}};
    const reload = () => vm.runInNewContext(source,{window,crypto:webcrypto,TextEncoder,sessionStorage:{
      getItem:k=>sessionStorage.get(k),setItem:(k,v)=>sessionStorage.set(k,v),removeItem:k=>sessionStorage.delete(k)
    }});
    const delivery = ['delivery-after','registration-after'].includes(fault);
    const file = new File(['gis data'],'test.geojson');
    const run = () => delivery
      ? window.geoBackend.uploadRequestDeliverable({id:'request',user_id:'owner'},file,{versionLabel:'v1'})
      : window.geoBackend.createRequest({name:'Test'},[file]);
    reload();
    if (delivery || fault === 'request-after') await assert.rejects(run(),/offline/);
    else assert.equal((await run()).fileFailures.length,1);
    inject = offline = false;
    reload();
    const result = await run();
    if (!delivery) assert.equal(result.fileFailures.length,0);
    assert.equal(rows.service_requests.length,delivery ? 0 : 1);
    const refs = rows[delivery ? 'request_deliverables' : 'request_files'];
    assert.equal(refs.length,1);
    assert.equal(objects.size,1);
    assert.equal(await objects.get(refs[0].object_path).text(),'gis data');
    assert.equal(sessionStorage.size,0);
  });
}
