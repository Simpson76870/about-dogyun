// 환율 정보판 "오래된 데이터 경고" 판정 모듈
// 가정: history.json = [{ "date": "YYYY-MM-DD", ... }, ...]  (기존 구조와 다르면 pickDate만 고치면 됨)
// 규칙: 마지막 정상 기록 날짜와 현재 날짜를 KST 날짜 기준으로 비교.
//       차이 0~3일 정상, 4일 이상 경고.

const STALE_AFTER_DAYS = 4;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstDate(d) {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s + "T00:00:00Z");
  return !isNaN(t) && t.toISOString().slice(0, 10) === s;
}

function dayDiff(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000);
}

function pickDate(rec) {
  return rec && typeof rec === "object" ? rec.date : undefined;
}

// rawText: history.json 원문, now: Date 또는 ISO 문자열
function evaluateFreshness(rawText, now) {
  const nowDate = now instanceof Date ? now : new Date(now);
  if (isNaN(nowDate)) return { status: "bad-now" };
  const today = kstDate(nowDate);

  let records;
  try {
    records = JSON.parse(rawText);
  } catch (e) {
    return { status: "corrupt", today };
  }
  if (!Array.isArray(records)) return { status: "corrupt", today };

  const valid = records.filter((r) => isValidDate(pickDate(r)));
  if (valid.length === 0) return { status: "empty", today };

  const lastRecord = valid.reduce((a, b) => (pickDate(b) > pickDate(a) ? b : a));
  const lastDate = pickDate(lastRecord);
  const gap = dayDiff(lastDate, today);

  if (gap < 0) return { status: "future", today, lastDate, lastRecord, gap };
  return { status: gap >= STALE_AFTER_DAYS ? "stale" : "fresh", today, lastDate, lastRecord, gap };
}

if (typeof module !== "undefined") module.exports = { evaluateFreshness, STALE_AFTER_DAYS };
