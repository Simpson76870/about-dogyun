create extension if not exists pgcrypto;

create table if not exists public.passkey_accounts (
  id text primary key check (id in ('demo-a','demo-b')),
  display_name text not null,
  private_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.passkey_credentials (
  credential_id text primary key,
  account_id text not null references public.passkey_accounts(id) on delete cascade,
  credential_public_key text not null,
  counter bigint not null default 0,
  transports jsonb not null default '[]'::jsonb,
  device_type text,
  backed_up boolean not null default false,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists passkey_credentials_account_id_idx
  on public.passkey_credentials(account_id);

create table if not exists public.passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references public.passkey_accounts(id) on delete cascade,
  challenge text not null unique,
  purpose text not null check (purpose in ('registration','authentication')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.passkey_sessions (
  session_hash text primary key,
  account_id text not null references public.passkey_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.passkey_accounts enable row level security;
alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;
alter table public.passkey_sessions enable row level security;

revoke all on public.passkey_accounts from anon, authenticated;
revoke all on public.passkey_credentials from anon, authenticated;
revoke all on public.passkey_challenges from anon, authenticated;
revoke all on public.passkey_sessions from anon, authenticated;

insert into public.passkey_accounts (id, display_name, private_items)
values
('demo-a', '테스트 계정 A', '[{"title":"프로젝트 메모","body":"가상 보안 실습 환경에서 인증 흐름과 접근 통제를 점검합니다."},{"title":"지원 준비 목록","body":"가상의 인프라 보안 직무를 조사하고 학습 항목을 정리합니다."},{"title":"학습 회고","body":"이번 주에는 WebAuthn challenge 검증과 세션 만료를 확인합니다."}]'::jsonb),
('demo-b', '테스트 계정 B', '[{"title":"실험 노트","body":"계정 B 전용 더미 자료입니다. 계정 A에서는 열리면 안 됩니다."},{"title":"가상 지원처","body":"가상의 회사 보안 운영 직무를 검토합니다."},{"title":"다음 목표","body":"패스키 삭제, challenge 재사용, 계정 간 접근 차단을 검증합니다."}]'::jsonb)
on conflict (id) do nothing;
