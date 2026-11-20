import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = await readFile(new URL('../github-template-store.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const remote = { template: { _empty: true }, page: { _empty: true }, sha: 'initial', writes: 0, conflict: false };

function client() {
  const session = new Map();
  const requests = [];
  const context = vm.createContext({
    window: {}, TextEncoder, TextDecoder, Uint8Array, btoa, atob, AbortSignal,
    crypto: { randomUUID },
    sessionStorage: {
      getItem: key => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, String(value)),
      removeItem: key => session.delete(key)
    },
    async fetch(url, options = {}) {
      requests.push({ url, options });
      if (url.startsWith('./shared-template.json')) {
        assert(!options.headers?.Authorization, 'Readers must not send administrator credentials');
        return Response.json(clone(remote.page));
      }
      assert(url.startsWith('https://api.github.com/repos/nadeldzx-glitch/price-calculator'));
      const token = options.headers.Authorization;
      if (token === 'Bearer expired') return Response.json({}, { status: 401 });
      if (url.endsWith('/git/blobs')) {
        return token === 'Bearer writer' ? Response.json({ sha: 'probe' }, { status: 201 }) : Response.json({}, { status: 403 });
      }
      if (options.method === 'PUT') {
        if (token !== 'Bearer writer') return Response.json({}, { status: 403 });
        const body = JSON.parse(options.body);
        if (remote.conflict || body.sha !== remote.sha) {
          remote.conflict = false;
          return Response.json({}, { status: 409 });
        }
        remote.template = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
        assert(!JSON.stringify(remote.template).includes('writer'), 'Tokens must not enter template files');
        remote.sha = randomUUID();
        remote.writes++;
        return Response.json({ content: { sha: remote.sha } });
      }
      if (url.includes('/contents/')) {
        return Response.json({ sha: remote.sha, content: Buffer.from(JSON.stringify(remote.template)).toString('base64') });
      }
      return Response.json({ permissions: { push: true } });
    }
  });
  vm.runInContext(source, context);
  return { store: context.window.githubTemplateStore, session, requests };
}

const ordinary = client();
assert(!ordinary.store.isSignedIn());
await assert.rejects(ordinary.store.publish({ _v: 166 }, null), /请先/);
assert.equal(ordinary.requests.length, 0);
const reader = client();
await assert.rejects(reader.store.signIn('reader'), /写入权限/);
assert(!reader.store.isSignedIn());
assert(!reader.session.has('bh_github_template_token'));

const admin = client();
await admin.store.signIn('writer');
assert(admin.store.isSignedIn());
const template = { _v: 166, style: '投票箱', s2_newPrice: '10400', _customCB: [{ name: '客户"定制 <特殊工序>', price: 1.25 }] };
const first = await admin.store.publish(template, null);
assert.equal(first.s2_newPrice, '10400');
assert.equal(first._customCB[0].name, template._customCB[0].name);
assert(first._publishedAt && first._revision);
assert.equal(remote.writes, 1);
assert.equal((await ordinary.store.read())._empty, true);
remote.page = clone(remote.template);
assert.equal((await ordinary.store.read()).s2_newPrice, '10400');

await assert.rejects(admin.store.publish(template, null), error => Boolean(error.latestTemplate));
assert.equal(remote.writes, 1);
const second = await admin.store.publish({ ...template, s2_newPrice: '10500' }, first._revision);
assert.equal(remote.writes, 2);
assert.notEqual(second._revision, first._revision);
remote.conflict = true;
await assert.rejects(admin.store.publish(template, second._revision), error => error.status === 409);
assert.equal(remote.writes, 2);

const unicode = await admin.store.publish({ ...template, note: '中文工序'.repeat(20000) }, second._revision);
assert.equal(remote.template.note, '中文工序'.repeat(20000));
await assert.rejects(admin.store.publish({ ...template, note: '中文工序'.repeat(60000) }, unicode._revision), /过大/);
admin.store.signOut();
assert(!admin.store.isSignedIn());
assert(!admin.session.has('bh_github_template_token'));
assert.equal(admin.session.get('role'), 'employee');
await assert.rejects(admin.store.signIn('expired'), error => error.status === 401);
assert(!admin.store.isSignedIn());
console.log('GitHub template checks passed for read/write permissions, two clients, Unicode, conflicts, token handling and sign-out.');
