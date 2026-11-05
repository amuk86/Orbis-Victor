const {test}=require('node:test');
const assert=require('node:assert/strict');
const base=process.env.ORBIS_TEST_URL??'http://127.0.0.1:3103';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw new Error('HTTP smoke test only runs against a local emulator-configured app.');
async function signup(label){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${label}-${Date.now()}@example.test`,password:'test-password-42',returnSecureToken:true})});assert.equal(r.status,200);return r.json();}
async function request(path,method='GET',body,token){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),timing:r.headers.get('server-timing')};}
test('actual HTTP handlers enforce authentication, validation, ownership, concurrency and public resume',async()=>{
 const owner=await signup('http-owner'),other=await signup('http-other');
 assert.equal((await request('/api/campaigns','GET')).status,401);
 assert.equal((await request('/api/campaigns','POST',{country:'za',requestId:'http-create'},'forged')).status,401);
 const created=await request('/api/campaigns','POST',{country:'za',requestId:'http-create'},owner.idToken);assert.equal(created.status,200);
 const path=`/api/campaigns/${created.data.id}`,initial=await request(path);assert.equal(initial.status,200);
 const command=initial.data.state.order[initial.data.state.turnIndex]==='human'?{type:'end'}:{type:'npc-step'};
 const payload={revision:0,requestId:'http-evil',command};
 assert.equal((await request(path+'/commands','POST',payload,other.idToken)).status,403);
 assert.equal((await request(path+'/commands','POST',{...payload,command:{...command,dice:[6]}},owner.idToken)).status,400);
 const simultaneous=await Promise.all(['http-a','http-b'].map(requestId=>request(path+'/commands','POST',{...payload,requestId},owner.idToken)));
 assert.deepEqual(simultaneous.map(x=>x.status).sort(),[200,409]);
 const confirmed=simultaneous.find(x=>x.status===200);assert.ok(confirmed.data.state);assert.ok(confirmed.data.timings.serverMs>=0);assert.match(confirmed.timing,/transaction;dur=/);
 const restored=await request(path);assert.deepEqual(confirmed.data.state.countries,restored.data.state.countries);assert.equal(restored.data.revision,1);assert.ok(restored.data.eventCount>initial.data.eventCount);
 assert.equal((await request(path,'DELETE',{revision:1},other.idToken)).status,403);
 assert.equal((await request(path,'DELETE',{revision:0},owner.idToken)).status,409);
 assert.equal((await request(path,'DELETE',{revision:1},owner.idToken)).status,200);
 assert.equal((await request(path)).status,404);
});
