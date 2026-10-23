# 과제 8 — 패스키 인증 구현 설명서

## ① 무엇으로 붙였나
WebAuthn 서버 검증은 `@simplewebauthn/server@13.1.2`, 데이터 접근은 `@supabase/supabase-js@2.57.0`를 사용하는 Supabase Edge Function으로 구현했다. 브라우저 측 등록·인증은 WebAuthn `navigator.credentials.create()`와 `navigator.credentials.get()`를 사용한다. 서버에는 credential ID, 공개키, 서명 카운터 및 메타데이터만 저장한다. 세션은 무작위 bearer token이며, 서버에는 SHA-256 해시만 저장한다.

## ② 왜 그걸 골랐나
정적 소개 페이지와 서버 측 인증 검증을 분리해야 비공개 자료를 HTML/JavaScript에 미리 넣지 않을 수 있다. WebAuthn 라이브러리는 challenge, origin, RP ID, 서명 및 사용자 검증 결과를 서버에서 확인하게 한다. Supabase Edge Function과 Postgres는 서버 코드와 영속 상태를 제공한다.

## ③ 어디를 어떻게 고쳤나
- 공개 소개와 패스키 UI: `index.html`의 `#passkey-private` 섹션 및 마지막 인라인 스크립트.
- 등록 옵션 발급: `supabase/functions/passkey-api/index.ts`, `POST /registration/options`.
- 등록 검증 및 공개키 저장: `POST /registration/verify`.
- 등록 취소 및 미사용 challenge 정리: `POST /registration/cancel`.
- 로그인 challenge 발급: `POST /authentication/options`.
- assertion 검증 및 세션 발급: `POST /authentication/verify`.
- 로그아웃 및 세션 폐기: `POST /logout`.
- 비공개 자료 조회: `GET /private` 및 `GET /private/:accountId`.
- 패스키 목록/삭제: `GET /credentials`, `POST /credentials/delete`.
- 데이터베이스 구조 및 더미 자료: `supabase/migrations/20261023090000_passkey_private_intro_area.sql`.

## ④ 안 열리는 것을 확인한 기록

**실행 결과:** GitHub Actions에서 WebAuthn 가상 인증기를 이용한 E2E 14/14 통과, 서버·공개 페이지 smoke test 8/8 통과. 실행 로그: https://github.com/Simpson76870/about-dogyun/actions/runs/39881057141

### 요청과 응답 기록

| 확인 | 요청 | 실제 응답 | 판정 |
|---|---|---|---|
| 로그인 없이 자료 열기 | `GET /private`, Authorization 없음 | `401 {"error":"authentication_required"}` | 거절 |
| 로그인 없이 계정 경로 열기 | `GET /private/demo-b`, Authorization 없음 | `401` | 거절 |
| A에서 B 자료 열기 | A 세션으로 `GET /private/demo-b` | `403 {"error":"account_scope_forbidden"}` | 거절 |
| B에서 A 자료 열기 | B 세션으로 `GET /private/demo-a` | `403 {"error":"account_scope_forbidden"}` | 거절 |
| 계정 ID 변조 | B 세션으로 `GET /private?accountId=demo-a` | `200`, 응답 계정은 계속 B이며 B의 자료 3개만 반환 | 내 자료만 반환 |
| challenge 재사용 | 동일 challenge로 `POST /authentication/verify` 2회 | 첫 시도는 등록되지 않은 credential로 거절, 두 번째는 `400 {"error":"challenge_expired_or_reused"}` | 재사용 거절 |
| 잘못된 서명 | 정상 assertion의 서명 바이트를 변경해 `POST /authentication/verify` | `401 {"error":"assertion_verification_failed"}` | 거절 |
| 로그아웃 후 이전 세션 | 로그아웃 후 같은 bearer token으로 `GET /private` | `401 {"error":"authentication_required"}` | 이전 세션 무효 |
| 삭제된 패스키 | 삭제한 credential ID로 인증 검증 요청 | `403` | 거절 |
| 마지막 패스키 삭제 | `POST /credentials/delete` 후 `POST /authentication/options` | `404 {"error":"no_passkeys_registered"}` | 로그인 불가 상태 확인 |
| 등록 challenge 취소 | `POST /registration/cancel` 후 같은 challenge로 등록 검증 | 취소 시 pending challenge 삭제, 재검증은 `400` | 취소 challenge 재사용 불가 |

A→B 및 B→A 거절 전후 각 계정의 자료 건수는 동일했다. 양쪽 계정에는 각각 서로 다른 더미 자료 3개가 있었으며, 실제 개인정보는 없다. 로그아웃 및 인증 요청의 세션 token 값은 제출 로그에 출력하지 않는다.

### 서버에 저장된 공개키 증거

인증된 `GET /credentials` 응답에서 서버 저장 공개키 2개를 확인했다. 아래 값은 **공개키**이며 개인키가 아니다.

- `CI 가상 인증기 A-1` — `pAEBAycgBiFYICyCUomH5UBWAnq42phv2yAwZgN4JaaX7RVnveGtD9dl`
- `CI 가상 인증기 A-2` — `pAEBAycgBiFYIHfk83ZrH2nsF2V-ZrS8HmdoTVzqJbMa-dIGYGi459YT`

등록 요청 본문은 WebAuthn credential의 ID, clientDataJSON, attestationObject, transports 등만 포함하며 `privateKey` 필드는 없다. 실제 인증기는 개인키를 브라우저 밖으로 내보내지 않는다.

### Challenge 값이 서로 다른 기록

등록 및 로그인 challenge의 전체 값은 재사용을 피하기 위해 제출문에 공개하지 않고, 테스트 로그에서 앞 8자리를 대조한다. 실제 smoke test 출력: `challengeA = FD2-1AI4…`, `challengeB = 8HFYnSgE…`, `distinct = true`. 이미 사용한 challenge 재사용은 별도로 실제 서버에서 400으로 거절됨을 확인했다.

## ⑤ AI와 나
- AI에게 맡긴 일: 기존 소개 페이지를 확인하고 WebAuthn 인증 흐름, 데이터 구조, API 및 UI 구현을 작성했다.
- 내가 직접 판단한 일: 공개 소개는 유지하고 비공개 자료는 서버 응답에만 두며, 계정 소유권 검사를 서버에서 수행하도록 구성했다.
- AI 제안을 따르지 않은 일: 패스키 인증을 화면에서만 흉내 내는 방식은 실제 인증이 아니므로 사용하지 않았다.

## ⑥ 아직 못 막은 것
초기 패스키 등록 시점의 계정 소유권을 별도의 초대·관리자 승인 절차로 증명하지 않는다. 따라서 이 구현의 공개 실습 계정은 실제 개인 자료용으로 사용하면 안 된다. 실제 서비스에 적용하려면 최초 credential 등록을 제한하는 안전한 프로비저닝 절차, 요청 빈도 제한/자동화 방어, 세션 토큰의 XSS 노출 위험을 줄이는 동일 사이트 HttpOnly 쿠키 구조, 운영 환경의 보안 모니터링을 추가해야 한다. 현재 계정 자료는 가상 데이터만 사용한다.

## 패스키 저장 위치
자동화 검증에서는 GitHub Actions의 Chrome 가상 인증기 2개를 서로 다른 기기로 취급해 등록·로그인·삭제 복구를 검증했다. 이는 Google Password Manager·기기 자체·보안 키 중 어느 실제 저장소를 사용했는지 증명하지 않는다. 실제 물리 기기/패스키 제공자 저장 위치는 아직 확인되지 않았으며, 해당 부분은 미검증으로 남긴다.

## 짧은 확인 방법
1. 어디로 가나요? `https://simpson76870.github.io/about-dogyun/` 의 공개 소개 페이지로 이동한다.
2. 세 단계 안에 무엇을 하나요? 실습 계정을 선택하고 패스키 이름을 입력한 뒤 등록을 누르고, 기기 확인을 완료한다. 이후 패스키로 로그인한다.
3. 무엇이 보이면 통과인가요? 공개 소개는 항상 보이고, 인증 성공 후에만 해당 계정의 가상 비공개 자료와 패스키 목록이 보인다.
4. 안 될 때는 무엇이 보이나요? 브라우저/기기 미지원, 사용자 취소, 미등록 패스키, challenge 만료·재사용, 401/403 등 서버 오류 안내가 표시된다.

## AI와 내 판단 — 제출 요약
- AI에게 맡긴 일: WebAuthn API와 서버 측 검증 흐름 및 제출 문서 초안 작성.
- 내가 직접 판단한 일: 공개 소개 유지, 가상 자료만 사용, 비공개 자료의 서버 측 권한 검증을 요구.
- AI 제안을 따르지 않은 일: 아직 실제 기기 인증 테스트를 수행하지 않았으므로 테스트 성공이나 패스키 저장 위치를 추측해 기입하지 않았다.
