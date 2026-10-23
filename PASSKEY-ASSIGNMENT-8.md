# 과제 8 — 패스키 인증 구현 설명서

## ① 무엇으로 붙였나
WebAuthn 서버 검증은 `@simplewebauthn/server@13.1.2`, 데이터 접근은 `@supabase/supabase-js@2.57.0`를 사용하는 Supabase Edge Function으로 구현했다. 브라우저 측 등록·인증은 WebAuthn `navigator.credentials.create()`와 `navigator.credentials.get()`를 사용한다. 서버에는 credential ID, 공개키, 서명 카운터 및 메타데이터만 저장한다. 세션은 무작위 bearer token이며, 서버에는 SHA-256 해시만 저장한다.

## ② 왜 그걸 골랐나
정적 소개 페이지와 서버 측 인증 검증을 분리해야 비공개 자료를 HTML/JavaScript에 미리 넣지 않을 수 있다. WebAuthn 라이브러리는 challenge, origin, RP ID, 서명 및 사용자 검증 결과를 서버에서 확인하게 한다. Supabase Edge Function과 Postgres는 서버 코드와 영속 상태를 제공한다.

## ③ 어디를 어떻게 고쳤나
- 공개 소개와 패스키 UI: `index.html`의 `#passkey-private` 섹션 및 마지막 인라인 스크립트.
- 등록 옵션 발급: `supabase/functions/passkey-api/index.ts`, `POST /registration/options`.
- 등록 검증 및 공개키 저장: `POST /registration/verify`.
- 로그인 challenge 발급: `POST /authentication/options`.
- assertion 검증 및 세션 발급: `POST /authentication/verify`.
- 로그아웃 및 세션 폐기: `POST /logout`.
- 비공개 자료 조회: `GET /private` 및 `GET /private/:accountId`.
- 패스키 목록/삭제: `GET /credentials`, `POST /credentials/delete`.
- 데이터베이스 구조 및 더미 자료: `supabase/migrations/20261023090000_passkey_private_intro_area.sql`.

## ④ 안 열리는 것을 확인한 기록
실제 브라우저 기기의 패스키 등록·로그인 동작이 수행되어야 하는 테스트는 브라우저에서 실행한 결과만 실측 증거로 기입한다. 아래는 결과를 기록할 형식이며, 아직 수행하지 않은 테스트를 통과로 주장하지 않는다.

| 확인 | 요청 | 기대 응답 | 실측 결과 |
|---|---|---|---|
| 로그인 없이 열기 | `GET /private` Authorization 헤더 없음 | 401 `authentication_required` | 미실측 |
| 남의 패스키로 열기 | A 세션에서 `GET /private/demo-b` | 403 `account_scope_forbidden` | 미실측 |
| challenge 재사용 | 이미 소비한 challenge로 `POST /authentication/verify` | 400 `challenge_expired_or_reused` | 미실측 |
| 패스키 삭제 뒤 로그인 | 삭제된 credential로 로그인 시도 | 404 `no_passkeys_registered` 또는 403 credential 불일치 | 미실측 |

추가로 성공한 assertion과 잘못된 서명, A→B 및 B→A 접근, 요청의 계정 ID 변조, 자료 건수 전후 비교, 로그아웃 후 기존 세션 재사용을 실제 요청/응답으로 기록해야 한다. 세션 토큰은 증거에 기록하지 않는다.

## ⑤ AI와 나
- AI에게 맡긴 일: 기존 소개 페이지를 확인하고 WebAuthn 인증 흐름, 데이터 구조, API 및 UI 구현을 작성했다.
- 내가 직접 판단한 일: 공개 소개는 유지하고 비공개 자료는 서버 응답에만 두며, 계정 소유권 검사를 서버에서 수행하도록 구성했다.
- AI 제안을 따르지 않은 일: 패스키 인증을 화면에서만 흉내 내는 방식은 실제 인증이 아니므로 사용하지 않았다.

## ⑥ 아직 못 막은 것
초기 패스키 등록 시점의 계정 소유권을 별도의 초대·관리자 승인 절차로 증명하지 않는다. 따라서 이 구현의 공개 실습 계정은 실제 개인 자료용으로 사용하면 안 된다. 실제 서비스에 적용하려면 최초 credential 등록을 제한하는 안전한 프로비저닝 절차, 요청 빈도 제한/자동화 방어, 세션 토큰의 XSS 노출 위험을 줄이는 동일 사이트 HttpOnly 쿠키 구조, 운영 환경의 보안 모니터링을 추가해야 한다. 현재 계정 자료는 가상 데이터만 사용한다.

## 패스키 저장 위치
실제 기기에서 등록한 패스키의 저장 위치는 등록을 수행한 브라우저/OS 인증기 화면에서 확인해 기록한다. 이 문서 작성 시점에는 실제 기기 등록 결과가 없어 Google Password Manager·기기 자체·보안 키 중 어느 곳에 저장되었는지 단정하지 않는다.

## 짧은 확인 방법
1. 어디로 가나요? `https://simpson76870.github.io/about-dogyun/` 의 공개 소개 페이지로 이동한다.
2. 세 단계 안에 무엇을 하나요? 실습 계정을 선택하고 패스키 이름을 입력한 뒤 등록을 누르고, 기기 확인을 완료한다. 이후 패스키로 로그인한다.
3. 무엇이 보이면 통과인가요? 공개 소개는 항상 보이고, 인증 성공 후에만 해당 계정의 가상 비공개 자료와 패스키 목록이 보인다.
4. 안 될 때는 무엇이 보이나요? 브라우저/기기 미지원, 사용자 취소, 미등록 패스키, challenge 만료·재사용, 401/403 등 서버 오류 안내가 표시된다.

## AI와 내 판단 — 제출 요약
- AI에게 맡긴 일: WebAuthn API와 서버 측 검증 흐름 및 제출 문서 초안 작성.
- 내가 직접 판단한 일: 공개 소개 유지, 가상 자료만 사용, 비공개 자료의 서버 측 권한 검증을 요구.
- AI 제안을 따르지 않은 일: 아직 실제 기기 인증 테스트를 수행하지 않았으므로 테스트 성공이나 패스키 저장 위치를 추측해 기입하지 않았다.
