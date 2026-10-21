// 사용: node handoff/run-checks.mjs            (고정 검사 10개 실행, results/ 에 회차 기록)
//       node handoff/run-checks.mjs --verify   (checks.json 이 고정본과 같은지만 확인)
// 필요: Node 18+, npm i -D playwright && npx playwright install chromium
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// 환율 정보판 위치 자동 탐색: 이 파일 위치에서 위로 올라가며 data/history.json 이 있는 폴더를 찾는다 (SITE_DIR 로 직접 지정 가능)
const cands = [];
if (process.env.SITE_DIR) cands.push(resolve(process.env.SITE_DIR));
let up = here;
for (let i = 0; i < 4; i++) { cands.push(up, join(up, 'fx-board')); up = join(up, '..'); }
const root = cands.find(d => existsSync(join(d, 'data', 'history.json')));
if (!root) { console.error('data/history.json 을 찾지 못했습니다. 찾아본 곳:\n  ' + cands.join('\n  ')); process.exit(3); }
const pageFile = existsSync(join(root, 'fx.html')) ? 'fx.html' : 'index.html';
console.log(`정보판 폴더: ${root}  페이지: ${pageFile}`);
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
// history.json 은 일별 기록 배열이다. "마지막 갱신 시각" = 마지막 항목의 fetched_at.
// 검사는 실제 파일 내용에 흔들리지 않도록 고정된 시험용 기록 2건에서 마지막 항목의 fetched_at 만 바꿔 입력한다.
const mkEntry = (date, usd, jpy) => ({
  date, fetched_at: `${date}T00:10:00Z`,
  pairs: {
    USDKRW: { rate: usd, unit: 'KRW', source_date: date },
    JPYKRW_100: { rate: jpy, unit: 'KRW per 100 JPY', source_date: date },
  },
  source: 'test-fixture',
});
const baseData = [mkEntry('2026-10-19', 1400.1, 920.5), mkEntry('2026-10-20', 1402.3, 921.4)];
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
    await page.route(/api\.frankfurter\.dev|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.route('**/data/history.json*', route => {
      if (c.input.http_status) return route.fulfill({ status: c.input.http_status, body: 'x' });
      const d = structuredClone(baseData);
      const last = d[d.length - 1];
      if ('updated_at' in c.input) {
        if (c.input.updated_at === null) delete last.fetched_at; else last.fetched_at = c.input.updated_at;
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    });
    await page.goto(`http://localhost:4173/${pageFile}?now=${encodeURIComponent(c.input.now)}`);
    await page.waitForSelector('#freshness[data-state]', { state: 'attached', timeout: 5000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
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
