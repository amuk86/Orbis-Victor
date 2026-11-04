const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, startingSoldiers, conquestGarrison, diceCount, currentPlayer, owned, transition } = require('../.test-build/engine.js');
const { nextNpcAction } = require('../.test-build/npc.js');
const pool = require('../data/countries.json');
const fixed = () => 0.5;
function fixture() {
  const s = createGame(pool, 'za', fixed, 'test');
  s.order = s.players.map(p => p.id); s.turnIndex = 0;
  s.countries[0].soldiers = 5;
  return s;
}
const act = (s, command, rng = fixed) => transition(s, { actorId: currentPlayer(s).id, ...command }, rng);
const attack = s => act(s, { type: 'attack', source: s.countries[0].code, target: s.countries[1].code }).state;
const alternating = () => { let n = 0; return () => (n++ % 2 === 0 ? 0.99 : 0); };

test('population boundaries are inclusive and all nine brackets are computed', () => {
  [5,10,25,50,75,100,125,150].forEach((n,i) => {
    assert.equal(startingSoldiers(n), i+1);
    assert.equal(startingSoldiers(n + .000001), i+2);
  });
  assert.equal(startingSoldiers(0.0005), 1);
  assert.equal(startingSoldiers(1476), 9);
  assert.throws(() => startingSoldiers(NaN));
});
test('snapshot contains 195 unique ISO countries and selects ten unique nations', () => {
  assert.equal(pool.length, 195); assert.equal(new Set(pool.map(c => c.code)).size, 195);
  const s = fixture();
  assert.equal(s.countries.length, 10); assert.equal(s.countries[0].code, 'za');
  assert.equal(new Set(s.countries.map(c => c.code)).size, 10);
  assert.equal(s.reinforcements, 0);
  assert.equal(new Set(s.players.map(p=>p.badge)).size,10);
  assert.notDeepEqual(createGame(pool, 'za', () => 0, 'a').order, createGame(pool, 'za', () => .99, 'b').order);
});
test('dice use the smaller force, with one attacker held back', () => {
  assert.equal(diceCount(10,2),2); assert.equal(diceCount(3,5),2);
  assert.equal(diceCount(2,5),1); assert.equal(diceCount(1,5),0);
});
test('ties kill nobody; input state is immutable; roll arrays stay in order', () => {
  const s = attack(fixture()); const before = JSON.stringify(s);
  const { state: next } = act(s, { type:'roll' });
  assert.equal(JSON.stringify(s), before);
  assert.equal(next.lastBattle.attackerLosses, 0); assert.equal(next.lastBattle.defenderLosses, 0);
  assert.equal(next.lastBattle.outcome, 'tie'); assert.equal(next.phase, 'battle');
  assert.deepEqual(next.events.slice(0,s.events.length), s.events);
});
test('dice are paired in order rather than sorted, and both armies can lose', () => {
  const s=fixture(); s.countries[0].soldiers=3;s.countries[1].soldiers=2;
  let i=0; const rolls=[0,1/6,3/6,2/6];
  const result=act(attack(s),{type:'roll'},()=>rolls[i++]).state;
  assert.deepEqual(result.lastBattle.attackerDice,[1,4]);
  assert.deepEqual(result.lastBattle.defenderDice,[2,3]);
  assert.equal(result.countries[0].soldiers,2); assert.equal(result.countries[1].soldiers,1);
});
test('conquest sets original-value reward, updates owner in place and eliminates last owner', () => {
  const s=fixture();s.countries[1].soldiers=1;s.countries[1].startingValue=9;
  const target=s.countries[1].code; const former=s.countries[1].ownerId;
  const result=act(attack(s),{type:'roll'},alternating()).state;
  assert.equal(result.countries[1].code,target); assert.equal(result.countries[1].ownerId,'human');
  assert.equal(result.countries[1].soldiers,4); assert.equal(owned(result,former).length,0);
  assert.equal(result.lastBattle.eliminated,true);
  assert.ok(result.events.some(e=>e.kind==='elimination'));
  assert.equal(conquestGarrison(1),2);assert.equal(conquestGarrison(5),2);
  assert.equal(result.phase,'action');
  assert.ok(act(result,{type:'attack',source:result.countries[0].code,target:result.countries[2].code}).error);
  assert.equal(act(result,{type:'transfer',source:result.countries[0].code,target,amount:1}).error,undefined);
});
test('first round has no reinforcements; round two grants two per owned country', () => {
  let s=fixture();
  for(let i=0;i<10;i++) { assert.equal(s.reinforcements,0); s=act(s,{type:'end'}).state; }
  assert.equal(s.round,2);assert.equal(s.reinforcements,2);assert.equal(s.phase,'reinforce');
  assert.ok(act(s,{type:'end'}).error);
  assert.ok(act(s,{type:'reinforce',country:s.countries[1].code}).error);
  s=act(s,{type:'reinforce',country:s.countries[0].code,amount:2}).state;
  assert.equal(s.phase,'action');assert.equal(s.countries[0].soldiers,7);
});
test('turn order skips eliminated players and round count advances on wrap', () => {
  let s=fixture();s.countries[1].ownerId='human';
  s=act(s,{type:'end'}).state;assert.equal(currentPlayer(s).id,'npc-2');
  s.turnIndex=9; s=act(s,{type:'end'}).state;
  assert.equal(currentPlayer(s).id,'human');assert.equal(s.round,2);assert.equal(s.reinforcements,4);
});
test('defeat leaves one soldier and original owners; stopping ends turn', () => {
  const s=fixture();s.countries[0].soldiers=2;s.countries[1].soldiers=5;
  let n=0;const r=act(attack(s),{type:'roll'},()=>n++%2===0?0:.99).state;
  assert.equal(r.countries[0].soldiers,1);assert.equal(r.countries[1].ownerId,'npc-1');assert.equal(r.attack,null);
  const stopped=act(attack(fixture()),{type:'stop'}).state;
  assert.equal(currentPlayer(stopped).id,'npc-1');assert.equal(stopped.attack,null);
});
test('transfer validation and actor check reject invalid commands without state changes', () => {
  const s=fixture();s.countries[1].ownerId='human';
  const source=s.countries[0].code,target=s.countries[1].code;
  for(const command of [
    {type:'transfer',source,target,amount:5}, {type:'transfer',source,target,amount:1.5},
    {type:'transfer',source,target:source}, {type:'transfer',source,target:s.countries[2].code},
  ]) {const r=act(s,command);assert.ok(r.error);assert.equal(r.state,s);}
  assert.ok(transition(s,{type:'end',actorId:'npc-1'},fixed).error);
  const r=act(s,{type:'transfer',source,target,amount:4}).state;
  assert.equal(r.countries[0].soldiers,1);
});
test('winning requires all ten and rejects further actions', () => {
  const s=fixture();s.countries.forEach((c,i)=>{if(i!==1)c.ownerId='human';});s.countries[1].soldiers=1;
  const r=act(attack(s),{type:'roll'},alternating()).state;
  assert.equal(r.winnerId,'human');assert.equal(r.phase,'finished');assert.equal(owned(r,'human').length,10);
  assert.ok(act(r,{type:'end'}).error);
});
test('NPC reinforces strongest, consolidates, scores targets, stops and logs reasons', () => {
  const s=fixture();s.turnIndex=1;s.countries[1].soldiers=6;s.countries[2].ownerId='npc-1';s.countries[2].soldiers=3;
  s.phase='reinforce';s.reinforcements=4;
  let a=nextNpcAction(s);assert.equal(a.type,'reinforce');assert.equal(a.country,s.countries[1].code);
  let r=transition(s,a,fixed);assert.ok(r.events.some(e=>e.kind==='decision'&&e.reason));
  a=nextNpcAction(r.state);assert.equal(a.type,'transfer');
  r=transition(r.state,a,fixed);a=nextNpcAction(r.state);assert.equal(a.type,'attack');
  r=transition(r.state,a,fixed);a=nextNpcAction(r.state);assert.equal(a.type,'roll');
  r=transition(r.state,a,fixed);
  r.state.countries[1].soldiers=2;assert.equal(nextNpcAction(r.state).type,'stop');
});
test('seeded campaigns reach a human win or loss and preserve invariants', () => {
  for(const seed of [1,7,42,119]) {
    let value=seed;const rng=()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};
    let s=createGame(pool,'za',rng,`sim-${seed}`);
    let steps=0;
    while(s.phase!=='finished'&&owned(s,'human').length>0&&steps++<5000) {
      let action;
      const p=currentPlayer(s);
      if(!p.human) action=nextNpcAction(s);
      else {
        const mine=owned(s,p.id).sort((a,b)=>b.soldiers-a.soldiers),base=mine[0];
        const donor=mine.find(c=>c.code!==base.code&&c.soldiers>1);
        const target=s.countries.filter(c=>c.ownerId!==p.id&&c.soldiers<base.soldiers).sort((a,b)=>b.soldiers-a.soldiers)[0];
        if(s.phase==='reinforce')action={type:'reinforce',country:base.code,amount:s.reinforcements};
        else if(s.phase==='battle')action={type:'roll'};
        else if(!s.attackUsed&&donor)action={type:'transfer',source:donor.code,target:base.code,amount:donor.soldiers-1};
        else if(!s.attackUsed&&target)action={type:'attack',source:base.code,target:target.code};
        else action={type:'end'};
        action.actorId=p.id;
      }
      const r=transition(s,action,rng);assert.equal(r.error,undefined);s=r.state;
      assert.equal(s.countries.length,10);
      assert.ok(s.countries.every(c=>Number.isInteger(c.soldiers)&&c.soldiers>=1));
      assert.ok(owned(s,currentPlayer(s).id).length>0);
    }
    assert.ok(s.phase==='finished'||owned(s,'human').length===0,`seed ${seed} must reach a human outcome`);
    if(s.winnerId)assert.equal(owned(s,s.winnerId).length,10);
  }
});
