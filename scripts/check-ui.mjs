import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(script => script.trim());

function storage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

async function fixture({ savedTemplate, deferTemplate = false } = {}) {
  const { window, document } = parseHTML(html);
  Object.defineProperty(window.HTMLInputElement.prototype, 'checked', {
    configurable: true,
    get() { return this.hasAttribute('checked'); },
    set(value) { this.toggleAttribute('checked', Boolean(value)); }
  });
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    configurable: true,
    get() { return (this.querySelector('option[selected]') || this.querySelector('option'))?.value ?? ''; },
    set(value) {
      this.querySelectorAll('option').forEach(option => option.toggleAttribute('selected', option.value === String(value)));
    }
  });
  const localStorage = storage();
  if(savedTemplate) localStorage.setItem('bh_quote_template', JSON.stringify(savedTemplate));
  const sessionStorage = storage();
  const requests = [];
  let resolveTemplate;
  const remoteTemplate = new Promise(resolve => { resolveTemplate = resolve; });
  const context = vm.createContext({
    document, window, localStorage, sessionStorage, console, Blob, URL, AbortSignal,
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () =>
        deferTemplate && String(url).startsWith('/shared-template.json') ? remoteTemplate : ({ _empty: true }) };
    }
  });
  window.githubTemplateStore = {
    isSignedIn: () => sessionStorage.getItem('role') === 'admin' && Boolean(sessionStorage.getItem('bh_github_template_token')),
    signIn: async token => { sessionStorage.setItem('bh_github_template_token', token); sessionStorage.setItem('role', 'admin'); },
    signOut: () => { sessionStorage.removeItem('bh_github_template_token'); sessionStorage.setItem('role','employee'); },
    read: async () => deferTemplate ? remoteTemplate : ({ _empty: true }),
    revision: template => template && !template._empty ? template._revision || template._publishedAt || null : null,
    publish: async template => ({...template, _publishedAt:new Date().toISOString(), _revision:'test-revision'})
  };
  for (const script of scripts) vm.runInContext(script, context);
  for (const element of document.querySelectorAll('[onclick]')) {
    const handler = vm.runInContext(`(function(event) { ${element.getAttribute('onclick')} })`, context);
    element.addEventListener('click', event => handler.call(element, event));
  }
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setImmediate(resolve));
  return {
    document, context, localStorage, sessionStorage, requests,
    async receiveTemplate(template) {
      resolveTemplate(template);
      await new Promise(resolve => setImmediate(resolve));
    },
    input(id, value) {
      const element = document.getElementById(id);
      element.value = String(value);
      element.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    run: code => vm.runInContext(code, context),
    set(values) {
      for (const [id, value] of Object.entries(values)) document.getElementById(id).value = String(value);
    },
    choose(style) { document.querySelector(`[data-style="${style}"]`).click(); },
    dim(value) { document.querySelector(`[data-dim="${value}"]`).click(); }
  };
}

const app = await fixture();
app.set({ s1_length: 400, s1_width: 302, s1_height: 230, s1_thickness: 5, s1_weight: 800,
  s1_quantity: 500, s1_usageRate: 100, s2_profit: 1000 });
app.choose('盒子');
assert.equal(app.run('state.dimType'), '');
assert.equal(app.document.getElementById('s1_dimtype_row').style.display, 'flex');
app.choose('投票箱');
app.dim('外尺');
let result = app.run('calcStep1()');
assert.deepEqual([result.Im, result.Jm, result.Ia, result.Ja], [904, 410, 330, 1074]);
assert(Math.abs(result.L - 0.72506) < 1e-12);
app.choose('箱子');
app.choose('纸箱式');
assert.equal(app.run('state.dimType'), '');
app.dim('内尺');
app.choose('盒子');
assert.equal(app.run('state.style'), '投票箱');
assert.equal(app.run('state.dimType'), '外尺');
app.choose('板材');
app.choose('箱子');
assert.equal(app.run('state.style'), '纸箱式');
assert.equal(app.run('state.dimType'), '内尺');

app.choose('板材');
app.set({ s1_length: 12, s1_width: 8, s1_quantity: 10000, s4_fractionAdj: 0 });
app.run('calcAll()');
const rawArea = 12 * 8 / 1e6;
const rawUnit = rawArea * 800 / 1e6 * (9000 + 1700 + 1000) * 1.07;
assert(Math.abs(app.run('calcStep2().V') - rawUnit) < 1e-12, 'Pricing must use unrounded area');
assert(Math.abs(app.run('calcStep4().J') - rawUnit * 10000) < 1e-9, 'Totals must use unrounded unit prices');
app.set({ s1_quantity: 0, s4_shipping: 120, s4_die: 30, s4_screen: 50 });
result = app.run('calcStep4()');
assert(Number.isFinite(result.I) && Number.isFinite(result.J), 'Blank or zero quantity must stay finite');
app.set({ s1_quantity: 500 });
result = app.run('calcStep4()');
assert.equal(result.F, 30, 'Die fee and screen fee must remain separate');
assert.equal(result.Fa, 50);

app.set({ parseInput: '投票箱 5 800 500 400×302×230 外尺' });
app.run('parseAndFill()');
assert.equal(app.run('state.style'), '投票箱', 'Text recognition must support voting boxes');
const parts = app.run('buildPrintParts()');
for (const key of ['verify', 'customer', 'verifyExcel', 'customerExcel']) {
  assert(!/NaN|Infinity|undefined/.test(parts[key]), key);
  assert.match(parts[key], /盒子\/投票箱/);
}

const unusualName = '客户"定制 <img src=x onerror="alert(1)">';
app.context.unusualName = unusualName;
app.run('addCustomCheckbox(unusualName, 1.25, true)');
assert.equal(app.document.querySelector('.cb-text-input').value, unusualName);
app.run('calcAll()');
assert.equal(app.document.querySelectorAll('#r3_process img').length, 0, 'Process names must render as text');
app.set({ s1_address: '<img src=x onerror="alert(1)">', s2_profit: 1000 });
app.run('_printParts = buildPrintParts(); renderPrintSheet()');
assert.equal(app.document.querySelectorAll('#printSheetContent img').length, 0, 'Addresses must render as text');

app.set({ s3_skeleton_edge: 8.75 });
app.run('onSkeletonEdgeInput()');
app.sessionStorage.setItem('role', 'admin');
app.sessionStorage.setItem('bh_github_template_token', 'test-only');
app.run('doSaveTemplate()');
const savedTemplate = JSON.parse(app.localStorage.getItem('bh_quote_template'));
app.set({ s2_newPrice: 12345 });
app.run("selectMaterialType(document.querySelector('[data-type=\"导电\"]'))");
assert.equal(app.run("defaults.materialPrices['普通'].newPrice"), 9000, 'Saved material prices must remain a snapshot');
const restored = await fixture({ savedTemplate });
assert.equal(restored.document.getElementById('s3_skeleton_edge').value, '8.75');
assert.equal(restored.document.getElementById('s3_skeleton_edge').getAttribute('data-user-set'), '1');
assert.equal(restored.document.querySelector('.cb-text-input').value, unusualName);
assert.equal(restored.run('state.dimType'), '外尺');
restored.run('resetAll()');
assert.equal(restored.document.getElementById('s3_skeleton_edge').value, '8.75');
assert.equal(restored.document.querySelectorAll('#cb_custom_grid .cb-item').length, 1);

for (const style of ['板材','圆盘','纸箱式','插底式','焊底式','骨架箱','全包式','四拼式','投票箱']) {
  for (const tax of ['是', '否']) {
    const scenario = await fixture();
    scenario.set({ s1_length: 400, s1_width: 200, s1_height: 230, s1_thickness: 5,
      s1_weight: 800, s1_quantity: 500, s2_profit: 1000, s1_tax: tax });
    scenario.choose(style);
    if(!['板材','圆盘'].includes(style)) scenario.dim('外尺');
    scenario.run('calcAll()');
    const values = scenario.run('({r1:calcStep1(),r2:calcStep2(),r3:calcStep3(),r4:calcStep4()})');
    for (const value of [values.r1.L, values.r1.M, values.r1.N, values.r2.V, values.r3.productUnitPrice, values.r4.I, values.r4.J]) {
      assert(Number.isFinite(value) && value > 0, `${style}, tax=${tax}`);
    }
    const print = scenario.run('buildPrintParts()');
    assert(!/NaN|Infinity|undefined/.test(print.verify));
    scenario.run('_printParts=buildPrintParts(); renderPrintSheet()');
    scenario.run("selectPrintOpt('customer')");
    assert(!scenario.run('getCleanExcelHTML()').includes('原料成本'), 'Customer export must omit calculation details');
    scenario.run("selectPrintOpt('verify')");
    assert(scenario.run('getCleanExcelHTML()').includes('原料成本'), 'Verification export must include calculation details');
  }
}

const slow = await fixture({ deferTemplate: true });
assert.equal(slow.document.getElementById('r1_sheetL').textContent, '0.0', 'Initial calculations must work while the cloud request is pending');
slow.input('s1_length', 777);
await slow.receiveTemplate(savedTemplate);
assert.equal(slow.document.getElementById('s1_length').value, '777', 'Cloud initialization must preserve ongoing edits');
assert(slow.document.getElementById('bh-sync-banner'));
slow.document.querySelector('#bh-sync-banner button').click();
assert.equal(slow.document.getElementById('s1_length').value, savedTemplate.s1_length);
assert(slow.run('hasSavedTemplate()'), 'A valid cloud template counts as a saved template');
const pending = await fixture({ deferTemplate: true });
pending.input('s1_length', 777);
await pending.receiveTemplate({ _empty: true });
pending.run('resetAll()');
assert.equal(pending.document.getElementById('s1_length').value, '', 'Factory reset must use the original HTML defaults');
console.log('DOM checks passed for 18 style/tax combinations, pricing precision, zero quantity, dimensions, text recognition, templates, delayed loading and print/export.');
