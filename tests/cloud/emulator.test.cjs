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
