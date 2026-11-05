const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('These tests require BOTH emulators. They must never run on production.');
process.env.FIREBASE_PROJECT_ID='demo-orbis-victor';process.env.FIREBASE_USE_EMULATORS='true';
const {admin,authenticated}=require('../../.cloud-test-build/src/server/firebase-admin.js');
const {createCampaign,listCampaigns,publicCampaign,moveCampaign,deleteCampaign,digest}=require('../../.cloud-test-build/src/server/campaigns.js');
const {beginImport,uploadImportChunk,finishImport}=require('../../.cloud-test-build/src/server/imports.js');
const {createGame}=require('../../.cloud-test-build/src/game/engine.js');
const pool=require('../../data/countries.json');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,deleteDoc,collection,query,where,limit,getDocs}=require('firebase/firestore');
let rules,owner,other,ownerToken;
async function signup(email){
 const res=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'test-password-42',returnSecureToken:true})});
 assert.equal(res.status,200);return res.json();
}
before(async()=>{
 const host=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 rules=await initializeTestEnvironment({projectId:'demo-orbis-victor',firestore:{host:host[0],port:Number(host[1]),rules:fs.readFileSync('firestore.rules','utf8')}});
 await rules.clearFirestore();
 const a=await signup(`owner-${Date.now()}@example.test`),b=await signup(`other-${Date.now()}@example.test`);owner=a.localId;other=b.localId;ownerToken=a.idToken;
});
after(async()=>{await rules.cleanup();await Promise.all(require('firebase-admin/app').getApps().map(a=>a.delete()));});
test('Auth SDK supports password sign-up/sign-in/sign-out/reset and emulated Google credentials',async()=>{
 const {initializeApp,deleteApp}=require('firebase/app');
 const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,sendPasswordResetEmail,confirmPasswordReset,GoogleAuthProvider,signInWithCredential}=require('firebase/auth');
 const app=initializeApp({apiKey:'emulator-key',projectId:'demo-orbis-victor'},'auth-sdk-test');
 try{
  const auth=getAuth(app);connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
  const email=`sdk-${Date.now()}@example.test`;
  const created=await createUserWithEmailAndPassword(auth,email,'test-password-42');const uid=created.user.uid;
  await signOut(auth);assert.equal(auth.currentUser,null);
  assert.equal((await signInWithEmailAndPassword(auth,email,'test-password-42')).user.uid,uid);
  await sendPasswordResetEmail(auth,email);
  const codes=await(await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/demo-orbis-victor/oobCodes`)).json();
  const code=codes.oobCodes.find(c=>c.email===email&&c.requestType==='PASSWORD_RESET');assert.ok(code);
  await confirmPasswordReset(auth,code.oobCode,'changed-password-42');await signOut(auth);
  assert.equal((await signInWithEmailAndPassword(auth,email,'changed-password-42')).user.uid,uid);
  await signOut(auth);
  const google=await signInWithCredential(auth,GoogleAuthProvider.credential(JSON.stringify({sub:'google-emulator-case',email:'google-emulator@example.test',email_verified:true})));
  assert.equal(google.user.providerData[0].providerId,'google.com');
 }finally{await deleteApp(app);}
});
test('real Auth emulator ID tokens are verified; forged and missing tokens fail',async()=>{
 assert.equal(await authenticated(new Request('http://localhost',{headers:{authorization:`Bearer ${ownerToken}`}})),owner);
 await assert.rejects(()=>authenticated(new Request('http://localhost')),e=>e.status===401);
 await assert.rejects(()=>authenticated(new Request('http://localhost',{headers:{authorization:'Bearer forged'}})),e=>e.status===401);
});
test('public can view known campaign/history; all direct state writes are denied even to owner',async()=>{
 const {id}=await createCampaign(owner,'za','rules-test');
 const anon=rules.unauthenticatedContext().firestore(),own=rules.authenticatedContext(owner).firestore();
 await assertSucceeds(getDoc(doc(anon,'campaigns',id)));
 const pages=await assertSucceeds(getDocs(query(collection(anon,'campaigns',id,'history'),limit(20))));assert.equal(pages.size,1);
 await assertFails(setDoc(doc(own,'campaigns',id),{ownerId:owner,state:{}},{merge:true}));
 await assertFails(deleteDoc(doc(own,'campaigns',id)));
 await assertFails(getDocs(query(collection(anon,'campaigns'),limit(30))));
 await assertSucceeds(getDocs(query(collection(own,'campaigns'),where('ownerId','==',owner),where('status','==','ready'),limit(30))));
 await assertFails(getDocs(query(collection(rules.authenticatedContext(other).firestore(),'campaigns'),where('ownerId','==',owner),where('status','==','ready'),limit(30))));
 const publicView=await publicCampaign(id);assert.equal(publicView.id,id);
 await assert.rejects(()=>moveCampaign(id,other,0,{type:'end'},'not-owner'),e=>e.status===403);
 await assert.rejects(()=>deleteCampaign(id,other,0),e=>e.status===403);
});
test('saving/resuming and simultaneous requests commit exactly one version and history sequence',async()=>{
 const {id}=await createCampaign(owner,'jp','concurrency-test');
 let v=await publicCampaign(id),cmd=v.state.players.find(p=>p.id===v.state.order[v.state.turnIndex]).human?{type:'end'}:{type:'npc-step'};
 const results=await Promise.allSettled([moveCampaign(id,owner,0,cmd,'request-one'),moveCampaign(id,owner,0,cmd,'request-two')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const restored=await publicCampaign(id);assert.equal(restored.revision,1);assert.ok(restored.eventCount>v.eventCount);
 assert.deepEqual(restored.state.events.map(e=>e.id),Array.from({length:restored.eventCount},(_,i)=>i+1));
 const winner=results[0].status==='fulfilled'?'request-one':'request-two';
 assert.equal((await moveCampaign(id,owner,0,cmd,winner)).alreadyApplied,true);
 assert.equal((await publicCampaign(id)).revision,1);
 assert.ok((await listCampaigns(owner)).campaigns.some(c=>c.id===id));
 assert.ok(!(await listCampaigns(other)).campaigns.some(c=>c.id===id));
});
test('explicit staged import is validated, idempotent, private while staging, and retains source data',async()=>{
 const local=createGame(pool,'za',()=>.5,'local-import-case'),original=JSON.stringify(local),bytes=Buffer.from(original),chunks=Math.ceil(bytes.length/48000);
 const session=await beginImport(owner,local.id,digest(bytes),bytes.length,chunks);
 const anon=rules.unauthenticatedContext().firestore();await assertFails(getDoc(doc(anon,'users',owner,'imports',session.id)));
 for(let i=0;i<chunks;i++)await uploadImportChunk(owner,session.id,i,bytes.subarray(i*48000,(i+1)*48000).toString('base64'));
 await assert.rejects(()=>finishImport(other,session.id),e=>e.status===404);
 const imported=await finishImport(owner,session.id);const retry=await finishImport(owner,session.id);assert.equal(imported.id,retry.id);assert.equal(retry.alreadyImported,true);
 const cloud=await publicCampaign(imported.id);assert.equal(cloud.provenance,'local-import');assert.equal(cloud.eventCount,local.events.length);assert.deepEqual({...cloud.state,id:local.id},local);assert.equal(JSON.stringify(local),original);
 await deleteCampaign(imported.id,owner,0);await assert.rejects(()=>publicCampaign(imported.id),e=>e.status===404);
 await assert.rejects(()=>finishImport(owner,session.id),e=>e.status===410);
});
test('bad board import never creates a playable cloud campaign',async()=>{
 const local=createGame(pool,'za',()=>.5,'forged-local-save');local.countries[0].soldiers=999;
 const bytes=Buffer.from(JSON.stringify(local)),session=await beginImport(owner,local.id,digest(bytes),bytes.length,Math.ceil(bytes.length/48000));
 for(let i=0;i<Math.ceil(bytes.length/48000);i++)await uploadImportChunk(owner,session.id,i,bytes.subarray(i*48000,(i+1)*48000).toString('base64'));
 await assert.rejects(()=>finishImport(owner,session.id),e=>e.status===422);
 await assert.rejects(()=>publicCampaign(session.campaignId),e=>e.status===404);
});
test('long campaigns page complete event history without placing it in the board document',async()=>{
 const {id}=await createCampaign(owner,'za','history-pages-test');
 for(let i=0;i<25;i++){
  const view=await publicCampaign(id),p=view.state.players.find(p=>p.id===view.state.order[view.state.turnIndex]);
  const command=!p.human?{type:'npc-step'}:view.state.phase==='reinforce'?{type:'reinforce',country:view.state.countries.find(c=>c.ownerId==='human').code,amount:view.state.reinforcements}:view.state.phase==='battle'?{type:'roll'}:{type:'end'};
  await moveCampaign(id,owner,view.revision,command,`history-${i}`);
 }
 const latest=await publicCampaign(id);assert.ok(latest.firstPage>0);assert.ok(latest.state.events.length<latest.eventCount);
 const stored=(await admin().db.collection('campaigns').doc(id).get()).data();assert.equal('events' in stored.state,false);
 let page=await publicCampaign(id,{after:0}),all=[...page.state.events];
 while(page.hasMore){page=await publicCampaign(id,{after:page.nextPage});all.push(...page.state.events);}
 assert.equal(all.length,latest.eventCount);assert.deepEqual(all.map(e=>e.id),Array.from({length:latest.eventCount},(_,i)=>i+1));
});

async function npcFixture(id){
 const s=createGame(pool,'za',()=>.5,id);s.order=s.players.map(p=>p.id);s.turnIndex=1;
 for(const c of s.countries)c.soldiers=2; // deterministic peaceful turns; no dice needed
 const {persistNew}=require('../../.cloud-test-build/src/server/campaigns.js');
 await admin().db.runTransaction(async tx=>{persistNew(tx,id,owner,s,'cloud');});
 return publicCampaign(id);
}
test('batch reply contains committed board and full new history; retries and simultaneous moves never duplicate it',async()=>{
 const initial=await npcFixture('batch-concurrent-test');
 const command={type:'npc-batch'};
 const results=await Promise.allSettled(['batch-a','batch-b'].map(requestId=>moveCampaign(initial.id,owner,0,command,requestId)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const reply=results.find(r=>r.status==='fulfilled').value;
 assert.equal(reply.actions,9);assert.equal(reply.revision,1);assert.equal(reply.firstPage,initial.nextPage);
 assert.equal(reply.frames.length,reply.actions);
 const {replayStates}=require('../../.cloud-test-build/src/cloud/replay.js');
 const playback=[...replayStates(initial.state,reply.state.events,reply.frames)];
 assert.equal(reply.state.order[reply.state.turnIndex],'human');
 const resumed=await publicCampaign(initial.id);
 assert.deepEqual(playback.at(-1),resumed.state);
 assert.deepEqual(reply.state.countries,resumed.state.countries);
 assert.deepEqual([...initial.state.events,...reply.state.events],resumed.state.events);
 assert.equal(reply.eventCount,resumed.eventCount);
 assert.ok(reply.timings.transactionMs>=reply.timings.simulationMs);assert.ok(reply.timings.attempts>=1);
 const winner=results[0].status==='fulfilled'?'batch-a':'batch-b';
 const retry=await moveCampaign(initial.id,owner,0,command,winner);
 assert.equal(retry.alreadyApplied,true);assert.deepEqual(retry.state,reply.state);
 assert.equal((await publicCampaign(initial.id)).eventCount,reply.eventCount);
 await assert.rejects(()=>moveCampaign(initial.id,other,1,command,'intruder'),e=>e.status===403);
});
test('simultaneous identical batch requests are idempotent and commit only one revision',async()=>{
 const initial=await npcFixture('batch-same-request');
 const replies=await Promise.all([1,2].map(()=>moveCampaign(initial.id,owner,0,{type:'npc-batch'},'same-batch-request')));
 assert.equal(replies.filter(x=>x.alreadyApplied).length,1);
 assert.equal(replies[0].revision,1);assert.deepEqual(replies[0].state,replies[1].state);
});
test('batch reduces nine NPC transactions to one with the same saved result',async t=>{
 const single=await npcFixture('batch-benchmark-single'),batch=await npcFixture('batch-benchmark-multi');
 let v=single,requests=0;const start=performance.now();
 while(v.state.order[v.state.turnIndex]!=='human'){
  v=await moveCampaign(single.id,owner,v.revision,{type:'npc-step'},`step-${requests++}`);
 }
 const singleMs=performance.now()-start,batchStart=performance.now();
 const result=await moveCampaign(batch.id,owner,0,{type:'npc-batch'},'benchmark-batch');
 const batchMs=performance.now()-batchStart;
 assert.equal(requests,9);assert.equal(result.actions,requests);assert.equal(v.revision,9);assert.equal(result.revision,1);
 const singleSaved=await publicCampaign(single.id),batchSaved=await publicCampaign(batch.id);
 assert.deepEqual({...singleSaved.state,id:'same'}, {...batchSaved.state,id:'same'});
 t.diagnostic(`Local emulator: ${requests} single transactions ${singleMs.toFixed(1)} ms; one batch ${batchMs.toFixed(1)} ms; batch Firestore transaction ${result.timings.transactionMs.toFixed(1)} ms. This is not a production latency benchmark.`);
});

test('complete reinforcement allocations commit once, preserve history, reject simultaneous stale requests and resume',async()=>{
 const id='allocation-integration',s=createGame(pool,'za',()=>.5,id);s.order=s.players.map(p=>p.id);s.turnIndex=0;s.round=2;s.phase='reinforce';s.reinforcements=4;s.countries[1].ownerId='human';
 const {persistNew}=require('../../.cloud-test-build/src/server/campaigns.js');
 await admin().db.runTransaction(async tx=>persistNew(tx,id,owner,s,'cloud'));
 const a=s.countries[0].code,b=s.countries[1].code,command={type:'reinforce-all',placements:[{country:a,amount:1},{country:b,amount:1},{country:a,amount:1},{country:b,amount:1}]};
 const initial=await publicCampaign(id);
 await assert.rejects(()=>moveCampaign(id,other,0,command,'not-owner'),e=>e.status===403);
 await assert.rejects(()=>moveCampaign(id,owner,0,{type:'reinforce-all',placements:[{country:a,amount:3}]},'partial'),e=>e.status===400);
 assert.equal((await publicCampaign(id)).revision,0);
 const replies=await Promise.allSettled(['allocation-a','allocation-b'].map(requestId=>moveCampaign(id,owner,0,command,requestId)));
 assert.equal(replies.filter(x=>x.status==='fulfilled').length,1);assert.equal(replies.find(x=>x.status==='rejected').reason.status,409);
 const winner=replies[0].status==='fulfilled'?'allocation-a':'allocation-b',reply=replies.find(x=>x.status==='fulfilled').value;
 const retry=await moveCampaign(id,owner,0,command,winner);assert.equal(retry.alreadyApplied,true);
 assert.deepEqual(reply.state,retry.state);
 const saved=await publicCampaign(id);assert.equal(saved.revision,1);assert.equal(saved.state.phase,'action');assert.equal(saved.state.reinforcements,0);
 assert.equal(saved.state.countries[0].soldiers,s.countries[0].soldiers+2);assert.equal(saved.state.countries[1].soldiers,s.countries[1].soldiers+2);
 assert.deepEqual(saved.state.events,[...initial.state.events,...reply.state.events]);assert.equal(saved.eventCount,initial.eventCount+4);
});

test('transfer batches are atomic, versioned, resumable, and safe to retry',async()=>{
 const id='transfer-integration',s=createGame(pool,'za',()=>.5,id);s.order=s.players.map(p=>p.id);s.turnIndex=0;
 s.phase='action';s.countries[0].soldiers=12;for(const c of s.countries.slice(0,3))c.ownerId='human';s.countries[1].soldiers=2;s.countries[2].soldiers=1;
 const {persistNew}=require('../../.cloud-test-build/src/server/campaigns.js');await admin().db.runTransaction(async tx=>persistNew(tx,id,owner,s,'cloud'));
 const a=s.countries[0].code,b=s.countries[1].code,enemy=s.countries[3].code;
 const command={type:'transfer-batch',moves:[{source:a,target:b,amount:1},{source:a,target:b,amount:1},{source:b,target:s.countries[2].code,amount:1}]};
 await assert.rejects(()=>moveCampaign(id,other,0,command,'intruder'),e=>e.status===403);
 await assert.rejects(()=>moveCampaign(id,owner,0,{type:'transfer-batch',moves:[command.moves[0],{source:a,target:enemy,amount:1}]},'invalid-tail'),e=>e.status===400);
 assert.equal((await publicCampaign(id)).revision,0);
 const results=await Promise.allSettled(['transfer-a','transfer-b'].map(requestId=>moveCampaign(id,owner,0,command,requestId)));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
 const winner=results[0].status==='fulfilled'?'transfer-a':'transfer-b';const retry=await moveCampaign(id,owner,0,command,winner);assert.equal(retry.alreadyApplied,true);
 const saved=await publicCampaign(id);assert.equal(saved.revision,1);assert.deepEqual(saved.state.countries.slice(0,3).map(c=>c.soldiers),[10,3,2]);
 assert.equal(saved.eventCount,s.events.length+3);assert.equal(saved.state.events.filter(e=>e.kind==='transfer').length,3);
});
