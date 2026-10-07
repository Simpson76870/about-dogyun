// 실행: node stale-check.test.js
// 검사 ID/입력/기대값은 작업 시작 시점에 고정한 것. 수정·삭제 금지.
const { evaluateFreshness } = require("./stale-check.js");

const rec = (...dates) => JSON.stringify(dates.map((d) => ({ date: d, USD_KRW: 1400, JPY_KRW: 9.4 })));

const tests = [
  ["T-01", rec("2026-10-06"), "2026-10-06T12:00:00+09:00", (r) => r.status === "fresh" && r.lastDate === "2026-10-06"],
  ["T-02", rec("2026-10-05"), "2026-10-06T12:00:00+09:00", (r) => r.status === "fresh"],
  ["T-03", rec("2026-10-02"), "2026-10-05T09:00:00+09:00", (r) => r.status === "fresh" && r.gap === 3],
  ["T-04", rec("2026-10-02"), "2026-10-06T09:00:00+09:00", (r) => r.status === "stale" && r.gap === 4],
  ["T-05", rec("2026-09-25", "2026-09-26"), "2026-10-06T09:00:00+09:00", (r) => r.status === "stale" && r.lastRecord.date === "2026-09-26"],
  ["T-06", "[]", "2026-10-06T09:00:00+09:00", (r) => r.status === "empty"],
  ["T-07", "{broken json", "2026-10-06T09:00:00+09:00", (r) => r.status === "corrupt"],
  ["T-08", rec("2026-10-09"), "2026-10-06T09:00:00+09:00", (r) => r.status === "future"],
  ["T-09", JSON.stringify([{ date: "2026-10-05" }, { date: "abc" }]), "2026-10-06T09:00:00+09:00", (r) => r.status === "fresh" && r.lastDate === "2026-10-05"],
  ["T-10", rec("2026-10-06"), "2026-10-09T15:30:00Z", (r) => r.status === "stale" && r.today === "2026-10-10" && r.gap === 4],
];

let pass = 0;
for (const [id, raw, now, check] of tests) {
  const r = evaluateFreshness(raw, now);
  const ok = check(r);
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} -> ${JSON.stringify({ status: r.status, gap: r.gap, today: r.today })}`);
}
console.log(`\n${pass}/${tests.length} 통과`);
process.exit(pass === tests.length ? 0 : 1);
