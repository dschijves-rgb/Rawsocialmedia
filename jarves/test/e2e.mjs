/**
 * e2e.mjs — drives the real app in a real Chromium at phone size.
 *
 *   cd jarves && python3 -m http.server 8731 &
 *   node test/e2e.mjs
 *
 * Needs playwright (`npm i playwright`). Set CHROME to a browser binary if the
 * bundled one isn't where this expects.
 */

import { chromium } from 'playwright';

const EXE = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:8731';
const SHOTS = process.env.SHOTS || '';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },      // Pixel-ish
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36',
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });

const say = async (text) => {
  // Sample BEFORE sending, or the reply can land first and we wait for one too many.
  const want = (await page.evaluate(() => document.querySelectorAll('.msg.jarves .bubble').length)) + 1;
  await page.fill('#input', text);
  await page.click('#sendBtn');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.msg.jarves .bubble').length >= n && !document.querySelector('.typing'),
    want,
    { timeout: 8000 }
  );
  return page.evaluate(() => {
    const all = [...document.querySelectorAll('.msg.jarves .bubble')];
    return all[all.length - 1].innerText.trim();
  });
};

const checks = [];
const check = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : '  <<< ' + detail}`);
};

check('welcome card renders', await page.locator('.welcome h2').isVisible());
check('mic button present', await page.locator('#micBtn').isVisible());

let r = await say('remember that I shoot content on Thursdays');
check('remember stores a fact', /remember that/i.test(r), r);

r = await say('remember that my rate card is 2400 a month');
check('second fact stores', /remember that/i.test(r), r);

r = await say('what do you know about the rate card');
check('recall finds the right fact', /2400/.test(r), r);

r = await say('what do you know about quantum mechanics');
check('recall admits an empty result', /nothing on file/i.test(r), r);

r = await say('note: call Tom back about the retainer');
check('note saves', /noted/i.test(r), r);

r = await say('show my notes');
check('notes list back', /call Tom back/i.test(r), r);

r = await say('check my email');
check('email lists', /Nadia|October content/i.test(r), r);
check('email admits it is sample data', /sample/i.test(r), r);

r = await say('read the one from Nadia');
check('email opens full body', /push the shoot/i.test(r), r);

r = await say('what can you do');
check('help lists capabilities', /Memory/i.test(r) && /Email/i.test(r), r);

r = await say('what is the airspeed velocity of an unladen swallow');
check('fallback refuses to bluff', /needs a real brain/i.test(r), r);

r = await say('forget that my rate card is 2400 a month');
check('forget removes a fact', /forgotten/i.test(r), r);

// drawer + counts
await page.click('#menuBtn');
await page.waitForSelector('#drawer:not([hidden])');
const factCount = await page.textContent('#factCount');
const noteCount = await page.textContent('#noteCount');
check('drawer fact count is right', factCount === '1', `got ${factCount}, expected 1`);
check('drawer note count is right', noteCount === '1', `got ${noteCount}, expected 1`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-drawer.png` });
await page.click('#closeDrawer');

// tool chips
const chips = await page.locator('.msg.tool').count();
check('tool usage is shown to the user', chips > 0, `${chips} chips`);

// theme toggle
await page.click('#menuBtn');
await page.click('#themeToggle');
await page.waitForTimeout(150);
const theme = await page.getAttribute('html', 'data-theme');
check('daylight mode switches', theme === 'light', `theme=${theme}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-light.png` });
await page.click('#themeToggle');
await page.click('#closeDrawer');
await page.waitForTimeout(150);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/shot-chat.png` });

// persistence across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const restored = await page.locator('.msg.user').count();
check('conversation survives a reload', restored > 5, `${restored} user messages restored`);
const stillKnows = await say('what do you know about Thursdays');
check('memory survives a reload', /Thursday/i.test(stillKnows), stillKnows);

// PWA bits
const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).status);
check('manifest is served', manifest === 200, `status ${manifest}`);
const sw = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
check('service worker registers', sw > 0, `${sw} registrations`);

// Ignore the Google Fonts request: this sandbox's TLS proxy blocks it. The app
// falls back to system-ui and it loads fine on a real device.
const appErrors = () => errors.filter((e) => !/fonts\.g(oogle|static)/.test(e) && !/ERR_CERT|ERR_TOO_MANY_RETRIES/.test(e));
check('no console errors', appErrors().length === 0, appErrors().slice(0, 4).join(' | '));

// --- connecting a model, and surviving a dead one ---
await page.click('#menuBtn');
await page.fill('#endpointInput', 'https://nope.invalid/brain');
await page.fill('#secretInput', 'test-secret');
await page.click('#connectBtn');
await page.waitForTimeout(250);
check('brain chip flips to Claude', (await page.textContent('#brainChip')) === 'Claude');
check('endpoint persists', (await page.evaluate(() => localStorage.getItem('jarves.endpoint'))) === 'https://nope.invalid/brain');

const degraded = await say('remember that the fallback works');
check('dead endpoint falls back to the shell brain, still answers', /remember that/i.test(degraded), degraded);
const notice = await page.evaluate(() => [...document.querySelectorAll('.msg.system .bubble')].map((b) => b.innerText).join(' '));
check('user is told the model was unreachable', /couldn.t reach the model/i.test(notice), notice.slice(-160));

await page.click('#menuBtn');
await page.click('#disconnectBtn');
await page.waitForTimeout(200);
check('disconnect returns to the shell brain', (await page.textContent('#brainChip')) === 'shell brain');
await page.click('#closeDrawer');

await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
