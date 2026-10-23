import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.1.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const RP_ID = "simpson76870.github.io";
const RP_NAME = "하도균 소개 페이지";
const ALLOWED_ORIGIN = "https://simpson76870.github.io";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function cors(origin: string | null) {
  const permitted = origin === ALLOWED_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(origin || "");
  return {
    "Access-Control-Allow-Origin": permitted ? origin! : ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "false",
    "Vary": "Origin",
  };
}
function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return b64url(bytes);
}
async function body(req: Request) { return await req.json().catch(() => ({})); }
async function issueChallenge(accountId: string, purpose: "registration" | "authentication", challenge: string) {
  const { error } = await db.from("passkey_challenges").insert({
    account_id: accountId, purpose, challenge, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  if (error) throw new Error("challenge_store_failed");
}
async function consumeChallenge(accountId: string, purpose: "registration" | "authentication", challenge: string) {
  const now = new Date().toISOString();
  const { data, error } = await db.from("passkey_challenges")
    .update({ used_at: now })
    .eq("account_id", accountId).eq("purpose", purpose).eq("challenge", challenge)
    .is("used_at", null).gt("expires_at", now).select("id").maybeSingle();
  return !error && !!data;
}
async function getSession(req: Request) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  if (token.length < 40 || token.length > 200) return null;
  const hash = await sha256(token);
  const now = new Date().toISOString();
  const { data } = await db.from("passkey_sessions").select("account_id,expires_at,revoked_at")
    .eq("session_hash", hash).gt("expires_at", now).is("revoked_at", null).maybeSingle();
  return data ? { accountId: data.account_id as string, hash } : null;
}
async function requireAccount(accountId: unknown) {
  if (accountId !== "demo-a" && accountId !== "demo-b") return null;
  const { data } = await db.from("passkey_accounts").select("id,display_name").eq("id", accountId).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (origin && origin !== ALLOWED_ORIGIN && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return json({ error: "origin_not_allowed" }, 403, origin);
  }
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/passkey-api/, "") || "/";
  try {
    if (req.method === "GET" && path === "/health") return json({ ok: true }, 200, origin);

    if (req.method === "POST" && path === "/registration/options") {
      const input = await body(req);
      const account = await requireAccount(input.accountId);
      if (!account) return json({ error: "unknown_account" }, 400, origin);
      const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
      if (!name) return json({ error: "passkey_name_required" }, 400, origin);
      const { data: existing } = await db.from("passkey_credentials").select("credential_id,transports").eq("account_id", account.id);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: account.display_name,
        userID: new TextEncoder().encode(account.id),
        attestationType: "none",
        excludeCredentials: (existing || []).map((c: any) => ({ id: c.credential_id, transports: c.transports || [] })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        timeout: 60000,
      });
      await issueChallenge(account.id, "registration", options.challenge);
      return json({ options, accountId: account.id, name }, 200, origin);
    }

    if (req.method === "POST" && path === "/registration/verify") {
      const input = await body(req);
      const account = await requireAccount(input.accountId);
      if (!account || !input.response || typeof input.challenge !== "string" || typeof input.name !== "string") {
        return json({ error: "invalid_request" }, 400, origin);
      }
      const consumed = await consumeChallenge(account.id, "registration", input.challenge);
      if (!consumed) return json({ error: "challenge_expired_or_reused" }, 400, origin);
      let verification: any;
      try {
        verification = await verifyRegistrationResponse({
          response: input.response,
          expectedChallenge: input.challenge,
          expectedOrigin: ALLOWED_ORIGIN,
          expectedRPID: RP_ID,
          requireUserVerification: true,
        });
      } catch {
        return json({ error: "registration_verification_failed" }, 400, origin);
      }
      if (!verification.verified || !verification.registrationInfo) {
        return json({ error: "registration_verification_failed" }, 400, origin);
      }
      const info = verification.registrationInfo;
      const credential = info.credential;
      const transports = Array.isArray(input.response.response?.transports) ? input.response.response.transports : [];
      const { error } = await db.from("passkey_credentials").insert({
        credential_id: credential.id,
        account_id: account.id,
        credential_public_key: b64url(credential.publicKey),
        counter: credential.counter,
        transports,
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        name: input.name.trim().slice(0, 60) || "내 패스키",
      });
      if (error) return json({ error: "credential_save_failed" }, 409, origin);
      return json({ verified: true, credentialId: credential.id, publicKey: b64url(credential.publicKey), publicKeyOnly: true }, 200, origin);
    }

    if (req.method === "POST" && path === "/authentication/options") {
      const input = await body(req);
      const account = await requireAccount(input.accountId);
      if (!account) return json({ error: "unknown_account" }, 400, origin);
      const { data: credentials } = await db.from("passkey_credentials")
        .select("credential_id,transports").eq("account_id", account.id);
      if (!credentials?.length) return json({ error: "no_passkeys_registered" }, 404, origin);
      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: credentials.map((c: any) => ({ id: c.credential_id, transports: c.transports || [] })),
        userVerification: "required",
        timeout: 60000,
      });
      await issueChallenge(account.id, "authentication", options.challenge);
      return json({ options, accountId: account.id }, 200, origin);
    }

    if (req.method === "POST" && path === "/authentication/verify") {
      const input = await body(req);
      const account = await requireAccount(input.accountId);
      if (!account || !input.response || typeof input.challenge !== "string") return json({ error: "invalid_request" }, 400, origin);
      const consumed = await consumeChallenge(account.id, "authentication", input.challenge);
      if (!consumed) return json({ error: "challenge_expired_or_reused" }, 400, origin);
      const { data: stored } = await db.from("passkey_credentials").select("*")
        .eq("account_id", account.id).eq("credential_id", input.response.id).maybeSingle();
      if (!stored) return json({ error: "credential_not_owned_by_account" }, 403, origin);
      let verification: any;
      try {
        verification = await verifyAuthenticationResponse({
          response: input.response,
          expectedChallenge: input.challenge,
          expectedOrigin: ALLOWED_ORIGIN,
          expectedRPID: RP_ID,
          credential: {
            id: stored.credential_id,
            publicKey: fromB64url(stored.credential_public_key),
            counter: Number(stored.counter),
            transports: stored.transports || [],
          },
          requireUserVerification: true,
        });
      } catch {
        return json({ error: "assertion_verification_failed" }, 401, origin);
      }
      if (!verification.verified) return json({ error: "assertion_verification_failed" }, 401, origin);
      const newCounter = verification.authenticationInfo.newCounter;
      await db.from("passkey_credentials").update({ counter: newCounter, last_used_at: new Date().toISOString() })
        .eq("credential_id", stored.credential_id).eq("account_id", account.id);
      const token = randomToken();
      const sessionHash = await sha256(token);
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const { error } = await db.from("passkey_sessions").insert({ session_hash: sessionHash, account_id: account.id, expires_at: expiresAt });
      if (error) return json({ error: "session_create_failed" }, 500, origin);
      return json({ verified: true, token, expiresAt, account: { id: account.id, displayName: account.display_name } }, 200, origin);
    }

    if (req.method === "GET" && path.startsWith("/private/")) {
      const session = await getSession(req);
      if (!session) return json({ error: "authentication_required" }, 401, origin);
      const requestedAccount = decodeURIComponent(path.slice("/private/".length));
      if (requestedAccount !== session.accountId) return json({ error: "account_scope_forbidden" }, 403, origin);
      const { data, error } = await db.from("passkey_accounts").select("id,display_name,private_items").eq("id", session.accountId).maybeSingle();
      if (error || !data) return json({ error: "private_data_unavailable" }, 404, origin);
      return json({ account: { id: data.id, displayName: data.display_name }, items: data.private_items }, 200, origin);
    }

    if (req.method === "GET" && path === "/private") {
      const session = await getSession(req);
      if (!session) return json({ error: "authentication_required" }, 401, origin);
      const { data, error } = await db.from("passkey_accounts").select("id,display_name,private_items").eq("id", session.accountId).maybeSingle();
      if (error || !data) return json({ error: "private_data_unavailable" }, 404, origin);
      return json({ account: { id: data.id, displayName: data.display_name }, items: data.private_items }, 200, origin);
    }

    if (req.method === "GET" && path === "/credentials") {
      const session = await getSession(req);
      if (!session) return json({ error: "authentication_required" }, 401, origin);
      const { data, error } = await db.from("passkey_credentials").select("credential_id,name,created_at,last_used_at,device_type,backed_up")
        .eq("account_id", session.accountId).order("created_at", { ascending: true });
      if (error) return json({ error: "credentials_unavailable" }, 500, origin);
      return json({ credentials: (data || []).map((c: any) => ({ id: c.credential_id, name: c.name, createdAt: c.created_at, lastUsedAt: c.last_used_at, deviceType: c.device_type, backedUp: c.backed_up })) }, 200, origin);
    }

    if (req.method === "POST" && path === "/credentials/delete") {
      const session = await getSession(req);
      if (!session) return json({ error: "authentication_required" }, 401, origin);
      const input = await body(req);
      if (typeof input.credentialId !== "string") return json({ error: "credential_id_required" }, 400, origin);
      const { data: target } = await db.from("passkey_credentials").select("credential_id")
        .eq("credential_id", input.credentialId).eq("account_id", session.accountId).maybeSingle();
      if (!target) return json({ error: "credential_not_owned_by_session" }, 403, origin);
      const { error } = await db.from("passkey_credentials").delete().eq("credential_id", input.credentialId).eq("account_id", session.accountId);
      if (error) return json({ error: "credential_delete_failed" }, 500, origin);
      return json({ deleted: true }, 200, origin);
    }

    if (req.method === "POST" && path === "/logout") {
      const session = await getSession(req);
      if (!session) return json({ error: "authentication_required" }, 401, origin);
      const { error } = await db.from("passkey_sessions").update({ revoked_at: new Date().toISOString() })
        .eq("session_hash", session.hash).is("revoked_at", null);
      if (error) return json({ error: "logout_failed" }, 500, origin);
      return json({ loggedOut: true }, 200, origin);
    }

    return json({ error: "not_found" }, 404, origin);
  } catch (error) {
    console.error("passkey-api internal error", error instanceof Error ? error.message : "unknown");
    return json({ error: "internal_error" }, 500, origin);
  }
});
