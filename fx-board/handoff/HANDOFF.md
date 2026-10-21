# 인수인계: AI A → AI B

- 코드 기준 커밋 ID: `⟦75f2808⟧` (A가 마지막으로 `fx-board/fx.html`을 바꾼 커밋. 이 문서와 FREEZE.md 수정 커밋은 그 뒤에 문서만 바꾼 커밋이다.)
- 작성: AI A (Claude) / 저장소: https://github.com/Simpson76870/about-dogyun
- B에게 제공하는 것은 이 저장소와 이 문서뿐이다. 앞 대화는 없다. 막히면 대화를 요구하지 말고 아래 "현재 상태"에 빠진 정보를 적어 문서를 고친다.

## 1. 목표
환율 정보판(`fx-board/fx.html`)에 "마지막 갱신 시각 표시 + 오래된 데이터 경고"를 추가한다. 고정 검사 10개(T-01~T-10, `fx-board/handoff/files (1)/checks.json`)를 전부 통과시키는 것이 완료다.
- 마지막 갱신 시각 = `fx-board/data/history.json`(일별 기록 배열) 마지막 항목의 `fetched_at`.
- 규칙: 지금과 갱신 시각의 차이가 36시간 이하면 `fresh`, 초과면 `stale`, 판단 불가면 `unknown`.
- 화면 계약: `#freshness`의 `data-state`는 `fresh | stale | unknown`. `#last-updated`는 `YYYY-MM-DD HH:mm KST · 경과`(1시간 미만 N분 전, 48시간 미만 N시간 전, 그 이상 N일 전). `#stale-banner`는 stale이면 "오래된 데이터", unknown이면 "갱신 시각을 알 수 없습니다"를 포함하고 fresh면 숨김. 환율 값 요소는 `data-rate="USD/KRW"` 등. 시험용으로 주소 `?now=<UTC ISO>`가 있으면 그 시각을 "지금"으로 쓴다.

## 2. 현재 상태
- A 종료 시점 검사 결과: **6/10 PASS**. T-01~T-05, T-10 통과. T-06~T-09 실패.
- 구현됨(`fx-board/fx.html`): `#freshness`, `#last-updated`, `#stale-banner`, `data-rate`, `?now=` 처리, 36시간 기준, 경과 표기, fresh/stale 판정.
- 미구현: `unknown` 처리. `renderFreshness()` 안의 `TODO(B)` 주석 자리에서 지금은 `pending`으로만 둔다.
- **첫 실패 검사: T-06** — `#freshness[data-state]="pending"` (기대 `unknown`), `#stale-banner`에 "갱신 시각을 알 수 없습니다" 없음.
- 사용량(A): 작업 시간 ⟦40⟧분 / 요청 ⟦7⟧회 (공통 상한 90분 · 25회).
- 시작 소스: 커밋 `ab44f7f` (0/10 기준선).
- 보정 1건(A 작업 중): 검사 도구 `run-checks.mjs`가 history.json을 객체로 가정했으나 실제는 배열이라, 입력 주입 방식(마지막 항목의 `fetched_at` 변경)과 외부 호출 차단을 고쳤다. `checks.json`은 불변이며 sha256 `350baa7d99df…`와 일치한다.

## 3. 실행 명령
- 권장(설치 없음): 코드를 `main`에 올리면(push) GitHub Actions `handoff-checks`가 자동 실행된다. Actions 탭 → 최신 실행 → `Run 10 frozen checks` 로그에서 PASS/FAIL 10줄과 `N/10 PASS`를 본다.
- 로컬(선택): Node 20 이상, 저장소 루트에서
  `npm i --no-save playwright && npx playwright install chromium && node "fx-board/handoff/files (1)/run-checks.mjs"`
  검사 파일 고정 여부만 확인: 같은 명령 끝에 `--verify`.
- 환경값·키·비밀값은 필요 없다.

## 4. 통과 검사
검사 내용(입력·기대값)은 `checks.json`이 기준이다. 그 파일을 읽고 따른다.

| ID | 내용 | A 종료 시점 |
|---|---|---|
| T-01 | 신선한 데이터, KST 표시, 경고 숨김 | PASS |
| T-02 | "6시간 전" | PASS |
| T-03 | 정확히 36시간 경계는 fresh | PASS |
| T-04 | 36시간 1분은 stale, 경고 표시 | PASS |
| T-05 | 5일 경과 | PASS |
| T-06 | 갱신 시각 없음 → unknown | FAIL |
| T-07 | 날짜가 아닌 글자 → unknown | FAIL |
| T-08 | 현재보다 미래 → unknown | FAIL |
| T-09 | history.json 404 → unknown, 경고, 화면 오류 없음 | FAIL |
| T-10 | stale에서도 마지막 환율 값 유지 | PASS (기존 동작으로 통과) |

## 5. 남은 문제
- T-06~T-09: unknown 상태 미구현.
- 갱신 시각이 없는 항목이 있으면 `renderHistory()`가 "조회 시각" 칸에 `undefined`를 찍는다(화면 정리는 선택 사항).
- 범위 밖(기록만): 매일 수집하는 Actions가 저장소 맨 위 `.github/workflows/`에 없어서 실제 `history.json`은 `[]`다. 그래서 실제 페이지는 지금 "처리 전" 상태로 보인다. 이번 과제에서 고치지 않는다.
- 설계 메모: 신선도는 저장된 기록 기준이며 페이지가 로드될 때 부르는 실시간 API의 성공과는 무관하다.

## 6. 다음 행동
1. 이 문서의 커밋 ID와 저장소의 실제 커밋을 대조한다(코드 기준 커밋 이후에 바뀐 건 문서뿐이어야 한다).
2. 최신 Actions 실행 로그에서 6/10이 보이는지 먼저 확인한다.
3. `fx-board/fx.html`의 `renderFreshness()` TODO를 구현한다. 마지막 항목이 없음 / `fetched_at` 없음 / 날짜 아님 / 현재보다 미래 / `data/history.json` 읽기 실패 → `data-state="unknown"`, `#last-updated`에 안내, `#stale-banner`를 보이고 "갱신 시각을 알 수 없습니다" 포함.
4. push → Actions → 10/10 확인. 실패하면 첫 실패 검사부터 고친다.
5. 끝나면 이 문서 맨 아래에 B 결과(작업 시간, 요청 수, 회차별 결과, 누락이 있었다면 수정 전후)를 적는다.

## 7. 건드리지 말 것
- `checks.json`, `checks.sha256`: 수정·삭제·완화·기대값 변경 금지(바꾸면 도구가 멈춘다).
- `run-checks.mjs`의 판정 로직(기대값 비교). 도구가 고장 났으면 문서에 기록하고 최소한만 고친다.
- `fx-board/scripts/fetch-rates.mjs`, 저장소의 Pages 배포 설정, 다른 페이지(`index.html` 등).
- 기존 정보판 기능(실패 시뮬레이션 버튼, 일별 기록 표, 어제 대비 변화).
- 상한: 작업 90분, 요청 25회. 개인정보·비밀값을 넣지 말 것.
