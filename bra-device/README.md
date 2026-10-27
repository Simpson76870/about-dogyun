# BR-A 기록 갱신 장치

이 장치는 로컬 JSON 기록으로부터 숫자 요약과 날짜·근거가 붙은 문단 후보를 다시 생성합니다. 외부 API나 로그인, API 키가 필요 없습니다. 같은 입력 파일과 같은 Python 버전 계열에서는 동일한 JSON 결과를 생성합니다.

## 실행 방법

1. Python 3.10 이상을 설치하고 이 폴더를 복사합니다.
2. `input/ritual_records.json`을 본인의 최신 기록으로 갱신합니다. 동료 실명·연락처·비밀값은 넣지 않습니다.
3. 터미널에서 이 폴더로 이동한 뒤 `python generate.py`를 실행합니다. 결과는 `output/latest_result.json`에 생성됩니다.

직접 경로를 지정하려면 `python generate.py --input input/ritual_records.json --output output/latest_result.json`을 실행합니다.

## 입력 형식

- `source`: 기록 출처 설명
- `summary.morning_count`, `summary.closing_count`: 원본 화면에서 확인한 집계 숫자
- `summary.record_period_start`, `summary.record_period_end`: 원본 기록 기간
- `records`: 날짜별 기록 배열. `date`, `type`, `strength`, `episode`, `comfortable_scene`, `peer_feedback`, `first_action` 등 기록 필드를 넣을 수 있습니다.

현재 포함된 입력은 2026-10-27에 제공된 자료를 바탕으로 한 검증 가능한 최소본입니다. 아침 49회와 마무리 48회는 사용자가 제공한 화면의 집계이고, 날짜별 세부 내용은 공유된 2026-10-27 아침 기록 한 건만 포함합니다. 출석·과제 제출 현황은 원본 집계가 제공되지 않아 계산하거나 추정하지 않았습니다.

## 확인과 공개 원칙

- 동일성 확인: `python generate.py`를 두 번 실행하고 매번 출력된 `SHA256` 값이 같은지 확인합니다.
- 격리 실행: 폴더를 새 위치에 복사한 뒤 위 실행 단계를 다시 수행합니다.
- `output/latest_result.json`은 후보 문장과 근거를 담습니다. 자동 공개 기능은 없습니다. 사용자가 사실관계를 확인하고 승인한 문장만 사이트에 옮깁니다.
- 동료 피드백은 가능한 한 요약하며 이름을 포함하지 않습니다.
