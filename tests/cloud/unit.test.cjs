const {test}=require('node:test');
const assert=require('node:assert/strict');
const {initialiseGame,createGame,transition}=require('../../.cloud-test-build/src/game/engine.js');
const {nextNpcAction}=require('../../.cloud-test-build/src/game/npc.js');
const {applyCommand,commandFrom}=require('../../.cloud-test-build/src/server/protocol.js');
const {historyPages}=require('../../.cloud-test-build/src/server/history.js');
const {validateImport}=require('../../.cloud-test-build/src/server/import-validation.js');
const pool=require('../../data/countries.json');
const {respond}=require('../../.cloud-test-build/src/server/http.js');
test('missing Firestore index produces an actionable error without leaking backend details',async()=>{
 const response=await respond(async()=>{throw Object.assign(new Error('The query requires an index. private-backend-details'),{code:9});});
 assert.equal(response.status,503);
 const body=await response.json();assert.match(body.error,/index is missing or still building/);assert.doesNotMatch(body.error,/private-backend-details/);
 const other=await respond(async()=>{throw Object.assign(new Error('private credentials'),{code:7});});
 assert.doesNotMatch((await other.json()).error,/private credentials/);
});
function state(){const s=createGame(pool,'za',()=>.5,'legacy-1234');s.order=s.players.map(p=>p.id);s.events[0]={...s.events[0],actorId:'human',text:'You takes the first turn.'};return s;}
function record(s=state()){const {events,...core}=s;return {ownerId:'owner',revision:4,eventCount:events.length,historyPages:1,state:core,status:'ready',provenance:'cloud',createdAt:'',updatedAt:'',lastRequestId:'',lastRequestHash:''};}
test('cloud commands reject state, ownership, actor, reasons and client dice',()=>{
 for(const command of [{type:'roll',dice:[6]},{type:'end',actorId:'human'},{type:'npc-step',state:{}},{type:'roll',ownerId:'owner'},{type:'end',reason:'cheat'}])assert.throws(()=>commandFrom(command),e=>e.status===400);
 assert.deepEqual(commandFrom({type:'launch',source:'za',target:'af'}),{type:'launch',source:'za',target:'af'});
});
test('only owner can control and stale revisions never advance RNG or state',()=>{
 const r=record();let calls=0;const rng=()=>{calls++;return .5;};
 assert.throws(()=>applyCommand(r,'visitor',4,{type:'end'},rng),e=>e.status===403);
 assert.throws(()=>applyCommand(r,'owner',3,{type:'end'},rng),e=>e.status===409);
 assert.equal(calls,0);assert.equal(r.revision,4);
});
test('server launch rolls authoritative RNG and maintains global event IDs without loading old history',()=>{
 const r=record();r.eventCount=500;r.state.countries[0].soldiers=5;r.state.countries[1].soldiers=1;
 let n=0;const result=applyCommand(r,'owner',4,{type:'launch',source:r.state.countries[0].code,target:r.state.countries[1].code},()=>n++%2===0?.99:0);
 assert.equal(result.events[0].id,501);assert.equal(result.state.lastBattle.attackerDice[0],6);assert.equal(result.state.lastBattle.defenderDice[0],1);
 assert.equal(result.state.countries[1].ownerId,'human');
});
test('NPC steps use server strategy and cannot run human commands in an NPC turn',()=>{
 const r=record();r.state.turnIndex=1;
 assert.throws(()=>applyCommand(r,'owner',4,{type:'roll'},()=>.5),e=>e.status===400);
 const result=applyCommand(r,'owner',4,{type:'npc-step'},()=>.5);
 assert.ok(result.events.some(e=>e.kind==='decision'&&e.reason));
});
test('legacy import reconstructs full state from canonical data and preserves battle progress',()=>{
 let s=state();
 s=transition(s,{type:'attack',actorId:'human',source:s.countries[0].code,target:s.countries[1].code},()=>.5).state;
 s=transition(s,{type:'roll',actorId:'human'},()=>.5).state;
 assert.deepEqual(validateImport(JSON.parse(JSON.stringify(s))),s);
 const forged=structuredClone(s);forged.countries[0].soldiers+=99;
 assert.throws(()=>validateImport(forged),e=>e.status===422);
 const fakeDice=structuredClone(s);fakeDice.lastBattle.attackerDice[0]=6;
 assert.throws(()=>validateImport(fakeDice),e=>e.status===422);
});
test('legacy import also replays randomized first commander, NPC decisions and turn changes',()=>{
 let s=createGame(pool,'jp',()=>.2,'legacy-npc');
 for(let i=0;i<60 && s.phase!=='finished';i++){
  const p=s.players.find(p=>p.id===s.order[s.turnIndex]);
  let action=p.human?s.phase==='reinforce'?{type:'reinforce',actorId:'human',country:s.countries.find(c=>c.ownerId==='human').code,amount:s.reinforcements}:{type:'end',actorId:'human'}:nextNpcAction(s);
  s=transition(s,action,()=>.5).state;
 }
 assert.deepEqual(validateImport(JSON.parse(JSON.stringify(s))),s);
});
test('history is chunked without truncation and page IDs remain monotonic',()=>{
 const events=Array.from({length:700},(_,i)=>({id:i+1,turn:1,round:1,actorId:'human',kind:'commentary',text:'x'.repeat(200)}));
 const pages=historyPages(events,9);assert.ok(pages.length>1);assert.equal(pages[0].seq,9);
 assert.deepEqual(pages.flatMap(p=>JSON.parse(p.json)),events);
 assert.ok(pages.every(p=>Buffer.byteLength(p.json)<70000));
});
