// scripts/fetch-rates.mjs
// GitHub Actions가 매일 실행하는 수집 스크립트.
// 키 없이 공개 API(Frankfurter, ECB 기준환율)를 호출해서
// data/history.json 에 "오늘(KST) 하루 한 건"만 추가한다.
//
// 이미 오늘 날짜(KST) 기록이 있으면 아무것도 하지 않고 조용히 종료한다.
// 두 통화쌍 중 하나라도 조회에 실패하면 그날은 기록을 남기지 않고 종료한다
// (실패를 숨기지 않고, 다음 실행을 기다리는 쪽을 택함).

import { readFile, writeFile } from "node:fs/promises";

const HISTORY_PATH = new URL("../data/history.json", import.meta.url);
const FETCH_TIMEOUT_MS = 10_000;

function todayKST() {
  // Asia/Seoul 기준 "YYYY-MM-DD" 날짜 키
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function nowKSTISO() {
  // 조회 시각을 KST 오프셋(+09:00)이 붙은 ISO 문자열로 남긴다.
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("Z", "+09:00");
}

async function fetchRate(from, to) {
  const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${from}->${to} HTTP ${res.status}`);
    }
    const body = await res.json();
    const rate = body?.rates?.[to];
    const sourceDate = body?.date;
    if (typeof rate !== "number" || !sourceDate) {
      throw new Error(`${from}->${to} 응답 형식이 예상과 다름: ${JSON.stringify(body)}`);
    }
    return { rate, sourceDate };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const dateKey = todayKST();

  let history = [];
  try {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    history = JSON.parse(raw);
  } catch {
    history = [];
  }

  if (history.some((entry) => entry.date === dateKey)) {
    console.log(`[skip] ${dateKey} 기록이 이미 있음 — 하루 한 건 규칙 유지`);
    return;
  }

  let usdKrw;
  let jpyKrw;
  try {
    usdKrw = await fetchRate("USD", "KRW");
    jpyKrw = await fetchRate("JPY", "KRW");
  } catch (err) {
    console.error(`[fail] 오늘(${dateKey}) 조회 실패, 기록을 남기지 않고 종료:`, err.message);
    // 실패를 감추지 않는다: 종료 코드 1로 끝내서 Actions 로그에 남긴다.
    // history.json은 건드리지 않으므로 화면에는 "마지막 정상값"이 계속 보인다.
    process.exitCode = 1;
    return;
  }

  const entry = {
    date: dateKey, // KST 캘린더 날짜 — 중복 방지 키
    fetched_at: nowKSTISO(), // 조회(수집) 시각
    pairs: {
      USDKRW: {
        rate: usdKrw.rate,
        unit: "KRW",
        source_date: usdKrw.sourceDate, // ECB 기준일 (원천 시각)
      },
      JPYKRW_100: {
        rate: Math.round(jpyKrw.rate * 100 * 100) / 100, // 원/100엔 관례
        unit: "KRW per 100 JPY",
        source_date: jpyKrw.sourceDate,
      },
    },
    source: "Frankfurter API (ECB reference rates)",
  };

  history.push(entry);
  history.sort((a, b) => (a.date < b.date ? -1 : 1));

  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n", "utf-8");
  console.log(`[ok] ${dateKey} 기록 추가:`, entry);
}

main();
