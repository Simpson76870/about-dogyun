import { chromium } from "playwright";

const PAGE = "https://simpson76870.github.io/about-dogyun/";
const API = "https://hjuczlxovnghkljzygoz.supabase.co/functions/v1/passkey-api";
const results = [];
function record(name, ok, detail) { results.push({name,ok,detail}); }
async function assert(name, fn) {
  try { const detail = await fn(); record(name,true,detail); }
  catch (error) { record(name,false,String(error)); throw error; }
}
async function pageFetch(page, path, {method="GET",body,token,headers={}}={}) {
  return await page.evaluate(async ({API,path,method,body,token,headers}) => {
    const h = {...headers};
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (token) h.Authorization = "Bearer " + token;
    const r = await fetch(API + path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),cache:"no-store"});
    return {status:r.status,body:await r.json().catch(()=>({}))};
  },{API,path,method,body,token,headers});
}
async function sessionToken(page) {
  return await page.evaluate(()=>sessionStorage.getItem("passkey_demo_session"));
}
async function currentCredentials(page, accountId) {
  const token=await sessionToken(page);
  const r=await pageFetch(page,"/credentials",{token});
  if(r.status!==200) throw new Error("credentials HTTP "+r.status);
  return r.body.credentials;
}
async function logout(page) {
  await page.locator("#passkey-logout").click();
  await page.waitForFunction(()=>!sessionStorage.getItem("passkey_demo_session"),null,{timeout:20000});
}
async function login(page, accountId) {
  await page.locator("#passkey-account").selectOption(accountId);
  await page.locator("#passkey-login").click();
  await page.waitForFunction(()=>document.querySelector("#passkey-private-content")?.hidden===false,null,{timeout:20000});
  const status=await page.locator("#passkey-status").textContent();
  if(!status.includes("성공")) throw new Error("login status: "+status);
}
const browser = await chromium.launch({headless:true,args:["--enable-features=WebAuthentication"]});
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{
  protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,
  isUserVerified:true,automaticPresenceSimulation:true
}});
try {
  await assert("Public introduction loads without login",async()=>{
    let ok=false;
    for(let i=0;i<18;i++){
      const response=await page.goto(PAGE,{waitUntil:"domcontentloaded",timeout:20000}).catch(()=>null);
      if(response?.ok() && await page.locator("#passkey-private").count()) {ok=true;break;}
      await page.waitForTimeout(5000);
    }
    if(!ok) throw new Error("Pages URL did not expose the passkey UI");
    const html=await page.content();
    if(html.includes("가상 보안 실습 환경에서 인증 흐름과 접근 통제를 점검합니다.") || html.includes("계정 B 전용 더미 자료입니다.")) throw new Error("private seed content found in public HTML");
    return "public page visible; private seed strings absent";
  });

  await assert("Unauthenticated private request is denied",async()=>{
    const r=await pageFetch(page,"/private");
    if(r.status!==401) throw new Error(JSON.stringify(r));
    return "401 authentication_required";
  });

  await assert("Register first passkey for account A and authenticate",async()=>{
    await page.locator("#passkey-account").selectOption("demo-a");
    await page.locator("#passkey-name").fill("CI 가상 인증기 A-1");
    await page.locator("#passkey-register").click();
    await page.waitForFunction(()=>document.querySelector("#passkey-private-content")?.hidden===false,null,{timeout:30000});
    const data=await pageFetch(page,"/private",{token:await sessionToken(page)});
    if(data.status!==200 || data.body.items?.length!==3) throw new Error("private content did not load: "+JSON.stringify({status:data.status,count:data.body.items?.length}));
    const creds=await currentCredentials(page,"demo-a");
    if(creds.length!==1) throw new Error("expected one credential, got "+creds.length);
    return "WebAuthn registration verified; 3 private items returned; server credential count=1";
  });

  await assert("Register second named passkey for account A",async()=>{
    const token=await sessionToken(page);
    const start=await pageFetch(page,"/registration/options",{method:"POST",body:{accountId:"demo-a",name:"CI 가상 인증기 A-2"},token});
    if(start.status!==200) throw new Error("second registration options status "+start.status);
    const response=await page.evaluate(async({options})=>{
      const from=(v)=>{const s=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
      const to=(v)=>{let s="";for(const b of new Uint8Array(v))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");};
      options.challenge=from(options.challenge);
      options.user.id=from(options.user.id);
      options.excludeCredentials=(options.excludeCredentials||[]).map(x=>({...x,id:from(x.id)}));
      const c=await navigator.credentials.create({publicKey:options});
      return {id:c.id,rawId:to(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response:{
        clientDataJSON:to(c.response.clientDataJSON),attestationObject:to(c.response.attestationObject),
        transports:c.response.getTransports?c.response.getTransports():[]
      }};
    },{options:start.body.options});
    const verified=await pageFetch(page,"/registration/verify",{method:"POST",body:{accountId:"demo-a",name:"CI 가상 인증기 A-2",challenge:start.body.options.challenge,response},token});
    if(verified.status!==200) throw new Error("second registration verify status "+verified.status);
    await logout(page);
    await login(page,"demo-a");
    const creds=await currentCredentials(page,"demo-a");
    if(creds.length!==2 || !creds.every(x=>x.name && x.createdAt && x.publicKey)) throw new Error("two named public-key credentials not present");
    return {credentialCount:creds.length,credentials:creds.map(x=>({name:x.name,publicKey:x.publicKey,createdAt:x.createdAt}))};
  });

  await assert("Authentication challenges are unique",async()=>{
    const a=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    const b=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    if(a.status!==200 || b.status!==200 || !a.body.options?.challenge || !b.body.options?.challenge || a.body.options.challenge===b.body.options.challenge) throw new Error("authentication challenges missing or repeated");
    return "two distinct login challenges";
  });

  await assert("Challenge replay is rejected",async()=>{
    const start=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    if(start.status!==200) throw new Error("options status "+start.status);
    const payload={accountId:"demo-a",challenge:start.body.options.challenge,response:{id:"not-a-real-credential"}};
    const first=await pageFetch(page,"/authentication/verify",{method:"POST",body:payload});
    const replay=await pageFetch(page,"/authentication/verify",{method:"POST",body:payload});
    if(first.status!==403 || replay.status!==400 || replay.body.error!=="challenge_expired_or_reused") throw new Error(JSON.stringify({first,replay}));
    return "first invalid credential rejected; same challenge replay rejected with 400";
  });

  await assert("Invalid signature is rejected",async()=>{
    const start=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    if(start.status!==200) throw new Error("options status "+start.status);
    const assertion=await page.evaluate(async ({options})=>{
      const from=(v)=>{const s=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4);return Uint8Array.from(atob(s),c=>c.charCodeAt(0));};
      const to=(v)=>{let s="";for(const b of new Uint8Array(v))s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");};
      options.challenge=from(options.challenge);
      options.allowCredentials=options.allowCredentials.map(c=>({...c,id:from(c.id)}));
      const c=await navigator.credentials.get({publicKey:options});
      const signature=new Uint8Array(c.response.signature);signature[0]^=1;
      return {id:c.id,rawId:to(c.rawId),type:c.type,clientExtensionResults:c.getClientExtensionResults(),response:{
        clientDataJSON:to(c.response.clientDataJSON),authenticatorData:to(c.response.authenticatorData),
        signature:to(signature),userHandle:c.response.userHandle?to(c.response.userHandle):null
      }};
    },{options:start.body.options});
    const r=await pageFetch(page,"/authentication/verify",{method:"POST",body:{accountId:"demo-a",challenge:start.body.options.challenge,response:assertion}});
    if(r.status!==401 || r.body.error!=="assertion_verification_failed") throw new Error(JSON.stringify({status:r.status,body:r.body}));
    return "tampered assertion signature rejected with 401";
  });

  await assert("Account B has independent data and a separate passkey",async()=>{
    await logout(page);
    await page.locator("#passkey-account").selectOption("demo-b");
    await page.locator("#passkey-name").fill("CI 가상 인증기 B-1");
    await page.locator("#passkey-register").click();
    await page.waitForFunction(()=>document.querySelector("#passkey-private-content")?.hidden===false,null,{timeout:30000});
    const data=await pageFetch(page,"/private",{token:await sessionToken(page)});
    if(data.status!==200 || data.body.account.id!=="demo-b" || data.body.items?.length!==3) throw new Error("B data invalid");
    return "account B authenticated with its own 3 dummy items";
  });

  await assert("B cannot read A and query tampering still returns B's own data",async()=>{
    const token=await sessionToken(page);
    const before=await pageFetch(page,"/private",{token});
    const forbidden=await pageFetch(page,"/private/demo-a",{token});
    const tampered=await pageFetch(page,"/private?accountId=demo-a",{token});
    const after=await pageFetch(page,"/private",{token});
    if(forbidden.status!==403 || tampered.status!==200 || tampered.body.account.id!=="demo-b" || before.body.items.length!==after.body.items.length) {
      throw new Error(JSON.stringify({forbidden,tampered: {status:tampered.status,account:tampered.body.account?.id},before:before.body.items?.length,after:after.body.items?.length}));
    }
    return "B→A target route 403; accountId query ignored; B item count unchanged";
  });

  await assert("A cannot read B",async()=>{
    await logout(page);
    await login(page,"demo-a");
    const token=await sessionToken(page);
    const before=await pageFetch(page,"/private",{token});
    const forbidden=await pageFetch(page,"/private/demo-b",{token});
    const after=await pageFetch(page,"/private",{token});
    if(forbidden.status!==403 || before.body.items.length!==after.body.items.length) throw new Error(JSON.stringify({forbidden,before:before.body.items?.length,after:after.body.items?.length}));
    return "A→B target route 403; A item count unchanged";
  });

  await assert("Logout revokes old session",async()=>{
    const oldToken=await sessionToken(page);
    await logout(page);
    const r=await pageFetch(page,"/private",{token:oldToken});
    if(r.status!==401) throw new Error(JSON.stringify(r));
    return "old bearer token receives 401 after logout";
  });

  await assert("Delete one of two passkeys; remaining credential still logs in",async()=>{
    await login(page,"demo-a");
    const creds=await currentCredentials(page,"demo-a");
    if(creds.length!==2) throw new Error("expected 2 credentials before delete");
    const deleted=creds[0];
    const token=await sessionToken(page);
    const del=await pageFetch(page,"/credentials/delete",{method:"POST",body:{credentialId:deleted.id},token});
    if(del.status!==200) throw new Error("delete status "+del.status);
    await logout(page);
    await login(page,"demo-a");
    const remaining=await currentCredentials(page,"demo-a");
    if(remaining.length!==1 || remaining[0].id===deleted.id) throw new Error("deleted credential still present");
    const options=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    const denied=await pageFetch(page,"/authentication/verify",{method:"POST",body:{accountId:"demo-a",challenge:options.body.options.challenge,response:{id:deleted.id}}});
    if(denied.status!==403) throw new Error("deleted credential accepted: "+JSON.stringify(denied));
    return "deleted credential rejected; remaining passkey still authenticates";
  });

  await assert("Last passkey deletion leaves no login credential",async()=>{
    const creds=await currentCredentials(page,"demo-a");
    if(creds.length!==1) throw new Error("expected one credential before final delete");
    const del=await pageFetch(page,"/credentials/delete",{method:"POST",body:{credentialId:creds[0].id},token:await sessionToken(page)});
    if(del.status!==200) throw new Error("last credential delete failed: "+JSON.stringify(del));
    const options=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-a"}});
    if(options.status!==404 || options.body.error!=="no_passkeys_registered") throw new Error(JSON.stringify(options));
    return "last credential deleted; next login options request returns 404 no_passkeys_registered";
  });

  await assert("Clean up virtual credentials for repeatable CI runs",async()=>{
    await logout(page);
    await login(page,"demo-b");
    const creds=await currentCredentials(page,"demo-b");
    const token=await sessionToken(page);
    for(const credential of creds){
      const del=await pageFetch(page,"/credentials/delete",{method:"POST",body:{credentialId:credential.id},token});
      if(del.status!==200) throw new Error("cleanup delete failed: "+del.status);
    }
    const options=await pageFetch(page,"/authentication/options",{method:"POST",body:{accountId:"demo-b"}});
    if(options.status!==404 || options.body.error!=="no_passkeys_registered") throw new Error("B credentials not cleaned");
    return "both demo accounts end with zero registered credentials";
  });


} finally {
  await cdp.send("WebAuthn.removeVirtualAuthenticator",{authenticatorId}).catch(()=>{});
  await browser.close();
}
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,results},null,2));
if(results.some(r=>!r.ok)) process.exit(1);
