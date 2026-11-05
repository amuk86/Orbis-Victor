// Requires a local emulator-configured Next server and Chrome; never run on a live project.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const base=process.env.ORBIS_TEST_URL??'http://localhost:3103';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)||!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Browser test requires localhost plus both demo emulators.');
process.env.FIREBASE_PROJECT_ID='demo-orbis-victor';process.env.FIREBASE_USE_EMULATORS='true';
const {admin}=require('../../.cloud-test-build/src/server/firebase-admin.js');
const {persistNew,publicCampaign}=require('../../.cloud-test-build/src/server/campaigns.js');
const {createGame}=require('../../.cloud-test-build/src/game/engine.js');
const pool=require('../../data/countries.json');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(work,label,timeout=60000){const start=Date.now();while(Date.now()-start<timeout){const value=await work();if(value)return value;await pause(100);}throw new Error(`Timed out: ${label}`);}
test('browser normal mode steps individually; fast-forward batches and avoids follow-up state GETs', {timeout:180000},async t=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'orbis-browser-batch-')),port=Number(process.env.ORBIS_CDP_PORT??9224);
 const chrome=spawn(process.env.CHROME_BIN??'/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
 let socket;const pending=new Map(),requests=[],exceptions=[];let seq=0;
 try{
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'Chrome startup');
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(new Error(message.error.message));else p.resolve(message.result);}
   if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);
   if(message.method==='Network.requestWillBeSent'){const r=message.params.request;if(r.url.startsWith(base+'/api/campaigns/'))requests.push({url:r.url,method:r.method,body:r.postData?JSON.parse(r.postData):null});}
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Network.enable');await send('Page.enable');
  const email=`batch-browser-${Date.now()}@example.test`,password='test-password-42';
  const signup=await(await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})).json();assert.ok(signup.localId);
  const suffix=Date.now(),ids=[`browser-normal-${suffix}`,`browser-fast-${suffix}`];
  for(const id of ids){const s=createGame(pool,'za',()=>.5,id);s.order=s.players.map(p=>p.id);s.turnIndex=1;for(const c of s.countries)c.soldiers=2;await admin().db.runTransaction(async tx=>persistNew(tx,id,signup.localId,s,'cloud'));}
  await send('Page.navigate',{url:base+'/account'});
  try{await until(()=>evaluate(`!!document.querySelector('input[type=email]')`),'account form');}catch(e){t.diagnostic(await evaluate('document.body.innerText.slice(0,900)'));t.diagnostic(JSON.stringify(exceptions));throw e;}
  await evaluate(`(()=>{for(const [type,value] of [['email',${JSON.stringify(email)}],['password',${JSON.stringify(password)}]]){const input=document.querySelector('input[type='+type+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('form button[type=submit]').click();})()`);
  await until(()=>evaluate(`document.body.innerText.includes('Signed in as')`),'sign-in');
  for(const [index,id] of ids.entries()){
   requests.length=0;await send('Page.navigate',{url:base+'/campaign/'+id});
   await until(()=>evaluate(`!![...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Fast-forward'))`),'game controls');
   await evaluate(`(()=>{const read=()=>document.querySelector('.ov-turn-status')?.textContent;window.__seenTurns=[{text:read(),time:performance.now()}];new MutationObserver(()=>{const text=read();if(text&&text!==window.__seenTurns.at(-1).text)window.__seenTurns.push({text,time:performance.now()});}).observe(document.body,{childList:true,subtree:true,characterData:true});})()`);
   if(index===1){
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Fast-forward')).click()`);
    await until(()=>evaluate(`document.querySelector('.cloud-toolbar')?.innerText.includes('Playing moves')`),'move-by-move playback');
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Menu').click()`);
    await pause(80);const paused=await evaluate(`document.querySelector('.ov-turn-status').textContent`);
    await pause(400);assert.equal(await evaluate(`document.querySelector('.ov-turn-status').textContent`),paused,'menu must pause playback');
    await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Resume campaign').click()`);
   }
   await until(async()=>{const v=await publicCampaign(id);return v.state.order[v.state.turnIndex]==='human';},'human turn');
   await until(()=>evaluate(`document.querySelector('.cloud-toolbar')?.innerText.includes('Saved revision')`),'confirmed response');
   await pause(500);
   const relevant=requests.filter(r=>r.url.includes('/api/campaigns/'+id)),moves=relevant.filter(r=>r.method==='POST');
   assert.equal(moves.length,index===0?9:1);
   assert.ok(moves.every(r=>r.body.command.type===(index===0?'npc-step':'npc-batch')));
   const firstPost=relevant.findIndex(r=>r.method==='POST');assert.equal(relevant.slice(firstPost+1).filter(r=>r.method==='GET').length,0,'own responses must not cause state GETs');
   assert.ok(await evaluate(`document.body.innerText.includes('Connection timing')`));
   const v=await publicCampaign(id);assert.equal(v.state.events.length,v.eventCount);
   const seen=await evaluate('window.__seenTurns');
   for(const p of v.state.players.filter(p=>!p.human))assert.ok(seen.some(s=>s.text.includes(p.name.toUpperCase()+"'S TURN")),`Missing visible turn: ${p.name}`);
   assert.ok(seen.at(-1).text.includes('YOUR TURN'));
   assert.equal(seen.length,10,'all nine NPC turns and the human turn must be shown');
   if(index===1)for(let n=2;n<seen.length;n++)assert.ok(seen[n].time-seen[n-1].time>=80,'confirmed actions must be displayed in separate frames');
   t.diagnostic(`${index===0?'Normal':'Fast-forward'}: ${moves.length} move request(s), no follow-up state fetches.`);
   if(index===1){
    await send('Page.reload');await until(()=>evaluate(`document.querySelector('.cloud-toolbar')?.innerText.includes('Saved revision 1')`),'resume batched campaign');
    assert.equal((await publicCampaign(id)).revision,1);
   }
  }
  assert.deepEqual(exceptions,[]);
 }finally{
  if(socket)socket.close();chrome.kill('SIGTERM');await new Promise(r=>{if(chrome.exitCode!==null)r();else chrome.once('exit',r);});
  fs.rmSync(profile,{recursive:true,force:true});await Promise.all(require('firebase-admin/app').getApps().map(a=>a.delete()));
 }
});
