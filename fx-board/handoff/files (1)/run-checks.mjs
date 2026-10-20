// 사용: node handoff/run-checks.mjs            (고정 검사 10개 실행, results/ 에 회차 기록)
//       node handoff/run-checks.mjs --verify   (checks.json 이 고정본과 같은지만 확인)
// 필요: Node 18+, npm i -D playwright && npx playwright install chromium
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const checksPath = join(here, 'checks.json');
const raw = readFileSync(checksPath);
const hash = createHash('sha256').update(raw).digest('hex');
const frozen = readFileSync(join(here, 'checks.sha256'), 'utf8').trim().split(/\s+/)[0];
if (hash !== frozen) {
  console.error(`FROZEN-MISMATCH: checks.json 이 고정본과 다릅니다\n  now   ${hash}\n  fixed ${frozen}`);
  process.exit(2);
}
console.log('checks.json == 고정본 (sha256 ' + hash.slice(0, 12) + '…)');
if (process.argv.includes('--verify')) process.exit(0);

const spec = JSON.parse(raw);
const { chromium } = await import('playwright');
const baseData = JSON.parse(readFileSync(join(root, 'data', 'history.json'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = join(root, p.endsWith('/') ? p + 'index.html' : p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': mime[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise(r => server.listen(4173, r));

const browser = await chromium.launch();
const rateTexts = {};
const results = [];

for (const c of spec.checks) {
  const outcome = { id: c.id, status: 'PASS', notes: [] };
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.route('**/data/history.json*', route => {
      if (c.input.http_status) return route.fulfill({ status: c.input.http_status, body: 'x' });
      const d = structuredClone(baseData);
      if ('updated_at' in c.input) {
        if (c.input.updated_at === null) delete d.updated_at; else d.updated_at = c.input.updated_at;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    });
    await page.goto(`http://localhost:4173/index.html?now=${encodeURIComponent(c.input.now)}`);
    await page.waitForSelector('#freshness[data-state]', { state: 'attached', timeout: 5000 });
    rateTexts[c.id] = await page.locator('[data-rate]').allTextContents();
    for (const e of c.expect) {
      let ok = false, why = '';
      if (e.type === 'attr') {
        const v = await page.locator(e.selector).first().getAttribute(e.name);
        ok = v === e.equals; why = `${e.selector}[${e.name}]="${v}" (기대 "${e.equals}")`;
      } else if (e.type === 'text') {
        const t = (await page.locator(e.selector).first().textContent({ timeout: 2000 }).catch(() => '')) || '';
        ok = t.includes(e.contains); why = `${e.selector} 글자에 "${e.contains}" 없음 (실제 "${t.trim().slice(0, 60)}")`;
      } else if (e.type === 'visible') {
        ok = await page.locator(e.selector).first().isVisible(); why = `${e.selector} 보이지 않음`;
      } else if (e.type === 'hidden') {
        ok = !(await page.locator(e.selector).first().isVisible()); why = `${e.selector} 가 보임`;
      } else if (e.type === 'no-pageerror') {
        ok = errors.length === 0; why = `페이지 오류: ${errors[0]}`;
      } else if (e.type === 'rates-equal') {
        const a = rateTexts[e.ref] || [], b = rateTexts[c.id] || [];
        ok = a.length > 0 && JSON.stringify(a) === JSON.stringify(b);
        why = `${e.selector} 값이 ${e.ref} 와 다름 (${JSON.stringify(a)} vs ${JSON.stringify(b)})`;
      }
      if (!ok) { outcome.status = 'FAIL'; outcome.notes.push(why); }
    }
  } catch (err) {
    outcome.status = 'FAIL'; outcome.notes.push('실행 중단: ' + String(err).split('\n')[0]);
  }
  await page.close();
  results.push(outcome);
  console.log(`${outcome.status}  ${c.id}  ${c.title}${outcome.notes.length ? '\n      ' + outcome.notes.join('\n      ') : ''}`);
}
await browser.close(); server.close();

const pass = results.filter(r => r.status === 'PASS').length;
mkdirSync(join(here, 'results'), { recursive: true });
const run = readdirSync(join(here, 'results')).filter(f => f.startsWith('run-')).length + 1;
writeFileSync(join(here, 'results', `run-${String(run).padStart(2, '0')}.json`),
  JSON.stringify({ run, at: new Date().toISOString(), checks_sha256: hash, pass, total: results.length, failed_run: pass < results.length, results }, null, 2));
console.log(`\n${pass}/${results.length} PASS  (회차 ${run}${pass < results.length ? ', 오류 회차로 집계' : ''})`);
process.exit(pass === results.length ? 0 : 1);
