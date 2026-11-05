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

const {NPC_BATCH_LIMIT}=require('../../.cloud-test-build/src/server/protocol.js');
const {mergeCampaignView,needsCampaignRefresh}=require('../../.cloud-test-build/src/cloud/campaign-state.js');
const {replayStates}=require('../../.cloud-test-build/src/cloud/replay.js');
function seeded(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function npcRecord(){const r=record();r.state.turnIndex=1;return r;}
test('NPC batches match individual actions, dice, decisions and complete event IDs for 60 seeds',()=>{
 for(let seed=1;seed<=60;seed++){
  const r=npcRecord(),batch=applyCommand(r,'owner',r.revision,{type:'npc-batch'},seeded(seed)),random=seeded(seed);
  let single=r;const all=[],expected=[];
  for(let i=0;i<batch.actions;i++){
   const next=applyCommand(single,'owner',single.revision,{type:'npc-step'},random);
   all.push(...next.events);const {events,...core}=next.state;
   expected.push({...next.state,events:[...all]});
   single={...single,state:core,revision:single.revision+1,eventCount:single.eventCount+events.length};
  }
  assert.deepEqual(batch.state,{...single.state,events:all});
  assert.equal(batch.frames.length,batch.actions);
  assert.deepEqual([...replayStates({...r.state,events:[]},batch.events,batch.frames)],expected);
  assert.deepEqual(batch.events.map(e=>e.id),Array.from({length:batch.events.length},(_,i)=>r.eventCount+i+1));
  assert.ok(batch.actions<=NPC_BATCH_LIMIT);
  assert.ok(batch.actions===NPC_BATCH_LIMIT||batch.state.phase==='finished'||batch.state.order[batch.state.turnIndex]==='human');
 }
});
test('batch limit bounds endless tied battles and safely resumes the same battle',()=>{
 const r=npcRecord(),a=r.state.countries[1],d=r.state.countries[0];a.soldiers=9;d.soldiers=8;
 r.state.phase='battle';r.state.attack={source:a.code,target:d.code};r.state.attackUsed=true;
 const first=applyCommand(r,'owner',4,{type:'npc-batch'},()=>.5);
 assert.equal(first.actions,NPC_BATCH_LIMIT);assert.equal(first.state.phase,'battle');
 const {events,...core}=first.state;
 const second=applyCommand({...r,state:core,revision:5,eventCount:r.eventCount+events.length},'owner',5,{type:'npc-batch'},()=>.5);
 assert.equal(second.actions,NPC_BATCH_LIMIT);assert.equal(second.events[0].id,first.events.at(-1).id+1);
 assert.equal(second.state.countries[1].soldiers,9);assert.equal(second.state.countries[0].soldiers,8);
});
test('batch stops at victory, refuses human turns, client limits, forged fields and stale/non-owner RNG',()=>{
 const r=npcRecord(),p=r.state.order[r.state.turnIndex];
 for(const c of r.state.countries)c.ownerId=p;
 const a=r.state.countries[1],d=r.state.countries[0];d.ownerId='human';d.soldiers=1;a.soldiers=9;
 r.state.phase='battle';r.state.attack={source:a.code,target:d.code};r.state.attackUsed=true;
 let n=0;const won=applyCommand(r,'owner',4,{type:'npc-batch'},()=>n++%2===0?.99:0);
 assert.equal(won.actions,1);assert.equal(won.state.phase,'finished');
 assert.throws(()=>applyCommand(record(),'owner',4,{type:'npc-batch'},()=>.5),e=>e.status===400);
 for(const c of [{type:'npc-batch',limit:999},{type:'npc-batch',dice:[6]},{type:'npc-batch',actorId:'human'}])assert.throws(()=>commandFrom(c),e=>e.status===400);
 assert.deepEqual(commandFrom({type:'npc-batch'}),{type:'npc-batch'});
 for(const [uid,rev,code] of [['visitor',4,403],['owner',3,409]])assert.throws(()=>applyCommand(r,uid,rev,{type:'npc-batch'},()=>{throw new Error('RNG ran before validation');}),e=>e.status===code);
});
function view(revision,firstPage,nextPage,historyPages=nextPage){return {id:'campaign-a',ownerId:'owner',revision,eventCount:revision,historyPages,provenance:'cloud',state:{...state(),events:[{...state().events[0],id:revision}]},firstPage,nextPage,hasMore:nextPage<historyPages};}
test('own move replies need no state fetch; listener notifications defer until response arrives',()=>{
 const old=view(1,0,2),reply=view(2,2,3);
 assert.equal(needsCampaignRefresh(old,2,true),false);
 const merged=mergeCampaignView(old,reply);
 assert.equal(needsCampaignRefresh(merged,2),false);
 assert.equal(needsCampaignRefresh(merged,3),true);
 assert.equal(needsCampaignRefresh(null,0),true);
 assert.equal(mergeCampaignView(merged,reply).state.events.length,2);
});
test('out-of-order fetches cannot roll back the board or skip history gaps',()=>{
 const old=view(1,0,2),reply=view(3,3,4),merged=mergeCampaignView(old,reply);
 assert.equal(merged.revision,3);assert.equal(merged.nextPage,2);assert.equal(merged.hasMore,true);
 const caughtUp=mergeCampaignView(merged,view(3,2,4));
 assert.equal(caughtUp.nextPage,4);assert.equal(caughtUp.hasMore,false);
 const stale=mergeCampaignView(caughtUp,view(2,2,3));
 assert.equal(stale.revision,3);assert.equal(stale.historyPages,4);assert.equal(stale.nextPage,4);
});

const {stageAllocation,allocationCommand}=require('../../.cloud-test-build/src/cloud/reinforcements.js');
function reinforceRecord(){const r=record();r.state.phase='reinforce';r.state.reinforcements=4;r.state.round=2;r.state.countries[1].ownerId='human';r.eventCount=500;return r;}
function reinforceView(r=reinforceRecord()){
 const prior={...state().events[0],id:r.eventCount};
 return {id:'allocation-case',ownerId:'owner',revision:r.revision,eventCount:r.eventCount,historyPages:1,provenance:'cloud',state:{...r.state,events:[prior]},firstPage:0,nextPage:1,hasMore:false};
}
test('rapid reinforcement clicks preview instantly and produce one complete allocation without mutating the saved board',()=>{
 const r=reinforceRecord(),v=reinforceView(r),before=structuredClone(v);let draft=null;
 for(let n=0;n<4;n++){
  draft=stageAllocation(v,'owner',v.state.countries[n===0?0:1].code,`request-${n}`,draft);
  assert.equal(draft.state.reinforcements,3-n);assert.equal(draft.complete,n===3);
  if(n<3)assert.throws(()=>allocationCommand(draft),/all available troops/);
 }
 assert.equal(draft.requestId,'request-0');assert.equal(draft.placements.length,4);assert.deepEqual(v,before);
 const command=allocationCommand(draft);assert.deepEqual(Object.keys(command).sort(),['placements','type']);
 const result=applyCommand(r,'owner',4,command,()=>{throw new Error('No dice expected');});
 assert.deepEqual(draft.state,{...result.state,events:[v.state.events[0],...result.events]});
 assert.deepEqual(result.events.map(e=>e.id),[501,502,503,504]);assert.equal(result.state.phase,'action');assert.equal(result.actions,4);
 assert.throws(()=>stageAllocation(v,'owner',v.state.countries[0].code,'extra',draft),/waiting to be saved/);
});
test('complete allocations reject under/over-allocation, enemies and wrong turns without partial changes',()=>{
 const r=reinforceRecord(),before=structuredClone(r),own=r.state.countries[0].code,enemy=r.state.countries[2].code;
 for(const placements of [[{country:own,amount:3}],[{country:own,amount:5}],[{country:own,amount:3},{country:enemy,amount:1}],[{country:own,amount:0}],[{country:own,amount:-4}],[]]){
  assert.throws(()=>applyCommand(r,'owner',4,{type:'reinforce-all',placements},()=>{throw new Error('No dice expected');}),e=>e.status===400);
  assert.deepEqual(r,before);
 }
 const valid={type:'reinforce-all',placements:[{country:own,amount:4}]};
 assert.throws(()=>applyCommand(r,'visitor',4,valid,()=>.5),e=>e.status===403);
 assert.throws(()=>applyCommand(r,'owner',3,valid,()=>.5),e=>e.status===409);
 assert.throws(()=>applyCommand({...r,state:{...r.state,turnIndex:2}},'owner',4,valid,()=>.5),e=>e.status===400);
 assert.throws(()=>applyCommand({...r,state:{...r.state,phase:'action'}},'owner',4,valid,()=>.5),e=>e.status===400);
});
test('allocation parsing rejects spoofed fields, oversized lists and invalid amounts',()=>{
 const placement={country:'za',amount:1};
 for(const value of [{type:'reinforce-all',placements:[placement],state:{}},{type:'reinforce-all',placements:[{...placement,actorId:'human'}]},{type:'reinforce-all',placements:[]},{type:'reinforce-all',placements:Array(21).fill(placement)},{type:'reinforce-all',placements:[{country:'za',amount:1.5}]},{type:'reinforce-all',placements:[{country:'za',amount:0}]}])assert.throws(()=>commandFrom(value),e=>e.status===400);
 assert.deepEqual(commandFrom({type:'reinforce-all',placements:[placement]}),{type:'reinforce-all',placements:[placement]});
});
test('allocation previews reject non-owners, enemy placement and campaigns changed by another tab',()=>{
 const v=reinforceView(),country=v.state.countries[0].code;
 assert.throws(()=>stageAllocation(v,'visitor',country,'draft'),/owner/);
 assert.throws(()=>stageAllocation(v,'owner',v.state.countries[2].code,'draft'));
 const draft=stageAllocation(v,'owner',country,'draft'),before=structuredClone(draft);
 assert.throws(()=>stageAllocation({...v,revision:v.revision+1},'owner',country,'new',draft),/changed/);
 assert.deepEqual(draft,before);
});
