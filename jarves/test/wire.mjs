/**
 * wire.mjs — proves the request we send Anthropic is shaped right, and that a
 * full tool_use -> tool_result -> text round trip closes, without spending a
 * cent. mock-api.mjs stands in for the worker.
 *
 *   cd jarves && python3 -m http.server 8731 &
 *   node test/wire.mjs
 */

import { chromium } from 'playwright';
import { start, seen } from './mock-api.mjs';

const server = await start(8732);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto('http://localhost:8731');
await page.evaluate(() => {
  localStorage.setItem('jarves.endpoint', 'http://localhost:8732');
  localStorage.setItem('jarves.secret', 'sekrit');
});
await page.reload({ waitUntil: 'networkidle' });

await page.fill('#input', 'remember that I shoot content on Thursdays');
await page.click('#sendBtn');
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('.msg.jarves .bubble')];
  return b.length && !document.querySelector('.typing');
}, null, { timeout: 10000 });

const reply = await page.evaluate(() => {
  const b = [...document.querySelectorAll('.msg.jarves .bubble')];
  return b[b.length - 1].innerText.trim();
});

const ok = [];
const chk = (n, p, d = '') => { ok.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p ? '' : '  <<< ' + d}`); };

chk('two API round trips (tool loop closed)', seen.length === 2, `${seen.length} calls`);

const r1 = seen[0]?.body || {};
chk('model is claude-opus-5', r1.model === 'claude-opus-5', r1.model);
chk('max_tokens is not lowballed', r1.max_tokens === 16000, String(r1.max_tokens));
chk('adaptive thinking', r1.thinking?.type === 'adaptive', JSON.stringify(r1.thinking));
chk('effort set', !!r1.output_config?.effort, JSON.stringify(r1.output_config));
chk('refusal fallback opted in', r1.fallbacks === 'default', JSON.stringify(r1.fallbacks));
chk('fallback beta sent', (r1.betas || []).includes('server-side-fallback-2026-07-01'), JSON.stringify(r1.betas));
chk('shared secret sent', seen[0]?.key === 'sekrit', seen[0]?.key);
chk('no prefill (last msg is user)', r1.messages.at(-1).role === 'user', r1.messages.at(-1).role);

const tool = (r1.tools || []).find((t) => t.name === 'remember');
chk('tools declared in API schema shape', !!tool?.input_schema?.properties?.text, JSON.stringify(tool)?.slice(0, 90));
chk('all 8 tools offered', (r1.tools || []).length === 8, `${(r1.tools || []).length} tools`);

const r2 = seen[1]?.body || {};
const results = r2.messages?.at(-1)?.content || [];
chk('tool_result returned in one user message', results.length === 1 && results[0].type === 'tool_result', JSON.stringify(results).slice(0, 90));
chk('tool_result carries the tool_use id', results[0]?.tool_use_id === 'toolu_1', results[0]?.tool_use_id);
chk('tool_result not flagged as error', results[0]?.is_error === false, String(results[0]?.is_error));

chk('final text reaches the user', /Thursdays are your shoot days/.test(reply), reply);

const stored = await page.evaluate(() => new Promise((res) => {
  const rq = indexedDB.open('jarves');
  rq.onsuccess = () => rq.result.transaction('facts').objectStore('facts').getAll().onsuccess = (e) => res(e.target.result.map((f) => f.text));
}));
chk('the tool actually wrote to memory', stored.includes('I shoot content on Thursdays'), JSON.stringify(stored));
chk('no page errors', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();
const bad = ok.filter((x) => !x).length;
console.log(`\n${ok.length - bad}/${ok.length} passed`);
process.exit(bad ? 1 : 0);
