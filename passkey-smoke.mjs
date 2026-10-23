const API = "https://hjuczlxovnghkljzygoz.supabase.co/functions/v1/passkey-api";
const PAGE = "https://simpson76870.github.io/about-dogyun/";
const results = [];
async function check(name, fn) {
  try { const detail = await fn(); results.push({name,ok:true,detail}); }
  catch (error) { results.push({name,ok:false,error:String(error)}); }
}
async function request(path, options={}) {
  const response = await fetch(API + path, {cache:"no-store", ...options});
  const body = await response.json().catch(()=>({}));
  return {status:response.status,body};
}
await check("API health", async () => {
  const r = await request("/health");
  if (r.status !== 200 || r.body.ok !== true) throw new Error(JSON.stringify(r));
  return "200";
});
await check("Private data rejects unauthenticated request", async () => {
  const r = await request("/private");
  if (r.status !== 401 || r.body.error !== "authentication_required") throw new Error(JSON.stringify(r));
  return "401 authentication_required";
});
await check("Target-account route rejects unauthenticated request", async () => {
  const r = await request("/private/demo-b");
  if (r.status !== 401) throw new Error(JSON.stringify(r));
  return "401";
});
await check("Unknown account cannot request authentication options", async () => {
  const r = await request("/authentication/options", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:"not-an-account"})});
  if (r.status !== 400 || r.body.error !== "unknown_account") throw new Error(JSON.stringify(r));
  return "400 unknown_account";
});
await check("Registration challenges are unique", async () => {
  const call = () => request("/registration/options", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId:"demo-a",name:"CI smoke test"})});
  const [a,b] = await Promise.all([call(),call()]);
  if (a.status !== 200 || b.status !== 200) throw new Error(JSON.stringify({a,b}));
  if (!a.body.options?.challenge || !b.body.options?.challenge || a.body.options.challenge === b.body.options.challenge) throw new Error("Challenge missing or repeated");
  return "two distinct challenges";
});
await check("Untrusted browser origin is rejected", async () => {
  const r = await request("/health", {headers:{Origin:"https://example.invalid"}});
  if (r.status !== 403 || r.body.error !== "origin_not_allowed") throw new Error(JSON.stringify(r));
  return "403 origin_not_allowed";
});
await check("Public HTML contains no private seed content", async () => {
  let html = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetch(PAGE,{cache:"no-store"});
    lastStatus = response.status;
    html = await response.text();
    if (response.ok && html.includes('id="passkey-private"') && !html.includes('      $("passkey-register").disabled = true;')) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (lastStatus < 200 || lastStatus >= 300) throw new Error("page HTTP " + lastStatus);
  if (!html.includes('id="passkey-private"') || html.includes('      $("passkey-register").disabled = true;')) throw new Error("Latest passkey UI did not reach Pages after waiting");
  if (html.includes("가상 보안 실습 환경에서 인증 흐름과 접근 통제를 점검합니다.") || html.includes("계정 B 전용 더미 자료입니다.")) throw new Error("Private data leaked into static HTML");
  return "public page loaded; private seed text absent";
});
console.log(JSON.stringify({total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results},null,2));
if (results.some(x=>!x.ok)) process.exit(1);
