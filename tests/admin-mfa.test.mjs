import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../backend.js', import.meta.url), 'utf8');
const securitySource = await readFile(new URL('../security.js', import.meta.url), 'utf8');
const verified = { id: 'test-factor', factor_type: 'totp', status: 'verified' };
const unverified = { ...verified, status: 'unverified' };

function backendFor(currentLevel, nextLevel, all, options = {}) {
  const client = { auth: {
    getUser: async () => ({ data: { user: options.noUser ? null : { id: 'test-user' } } }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel, nextLevel }, error: options.assuranceError }),
      listFactors: async () => ({ data: { all }, error: options.factorError })
    }
  } };
  const window = {
    GEO_RAFIDAIN_CONFIG: { supabaseUrl: 'https://test.supabase.co', publishableKey: 'sb_publishable_mock' },
    location: { protocol: 'https:' },
    supabase: { createClient: () => client }
  };
  vm.runInNewContext(source, { window });
  return window.geoBackend;
}

test('admin UI MFA gate rejects AAL1, stale AAL2 and missing/unverified factors', async () => {
  for (const [current, next, factors] of [
    ['aal1', 'aal1', []], ['aal1', 'aal2', [verified]],
    ['aal2', 'aal1', [verified]], ['aal2', 'aal2', []],
    ['aal2', 'aal2', [unverified]], [null, null, [verified]]
  ]) {
    assert.equal((await backendFor(current, next, factors).getAdminMfaState()).ready, false);
  }
  assert.equal((await backendFor('aal2', 'aal2', [verified]).getAdminMfaState()).ready, true);
  assert.equal((await backendFor('aal2', 'aal2', [{ ...verified, factor_type: 'phone' }]).getAdminMfaState()).ready, true);
});

test('admin UI MFA gate fails closed on missing session, invalid response or API errors', async () => {
  await assert.rejects(backendFor('aal2', 'aal2', undefined).getAdminMfaState(), /MFA_FACTORS_UNAVAILABLE/);
  await assert.rejects(backendFor('aal2', 'aal2', [verified], { noUser: true }).getAdminMfaState(), /AUTH_REQUIRED/);
  await assert.rejects(backendFor('aal2', 'aal2', [verified], { assuranceError: new Error('assurance unavailable') }).getAdminMfaState(), /assurance unavailable/);
  await assert.rejects(backendFor('aal2', 'aal2', [verified], { factorError: new Error('factors unavailable') }).getAdminMfaState(), /factors unavailable/);
});

function mfaState(currentLevel, nextLevel, verifiedFactors, ready = false) {
  return { assurance: { currentLevel, nextLevel }, verifiedFactors, ready };
}
async function securityPage(states) {
  const nodes = new Map();
  let verifyCalls = 0, enrollmentCalls = 0;
  const document = { querySelector(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: id !== '#security-loading', value: '', textContent: '',
      addEventListener(event, callback) { this[event] = callback; },
      removeAttribute(name) { delete this[name]; }, focus() {}
    });
    return nodes.get(id);
  } };
  const backend = {
    getUser: async () => ({ id: 'test-user' }),
    getProfile: async () => ({ role: 'admin' }),
    getAdminMfaState: async () => { assert.ok(states.length); return states.shift(); },
    verifyTotp: async () => { verifyCalls++; },
    enrollTotp: async () => { enrollmentCalls++; return { id: 'test-factor', totp: { qr_code: 'mock', secret: 'mock' } }; }
  };
  vm.runInNewContext(securitySource, { document, window: { geoBackend: backend, location: { replace() {} } } });
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, document, counts: () => ({ verifyCalls, enrollmentCalls }) };
}

test('security page never completes verification until the session is confirmed ready', async () => {
  for (const ready of [false, true]) {
    const page = await securityPage([mfaState('aal1', 'aal2', [verified]), mfaState('aal2', 'aal2', ready ? [verified] : [], ready)]);
    assert.equal(page.nodes.get('#security-challenge').hidden, false);
    assert.equal(page.nodes.get('#security-complete').hidden, true);
    page.document.querySelector('#challenge-code').value = '123456';
    const button = page.nodes.get('#confirm-challenge');
    await button.click({ currentTarget: button });
    assert.equal(page.counts().verifyCalls, 1);
    assert.equal(page.nodes.get('#security-complete').hidden, !ready);
    assert.equal(page.document.querySelector('#challenge-code').value, '');
    assert.equal(page.nodes.get('#totp-secret').textContent, '');
  }
});

test('security page blocks stale sessions and does not enroll automatically', async () => {
  const stale = await securityPage([mfaState('aal2', 'aal1', [])]);
  assert.equal(stale.nodes.get('#security-complete').hidden, true);
  assert.equal(stale.nodes.get('#security-enroll').hidden, true);
  assert.equal(stale.counts().enrollmentCalls, 0);
  const fresh = await securityPage([mfaState('aal1', 'aal1', [])]);
  assert.equal(fresh.nodes.get('#security-enroll').hidden, false);
  assert.equal(fresh.counts().enrollmentCalls, 0);
});
