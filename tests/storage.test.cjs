const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGame, transition, currentPlayer } = require('../.test-build/engine.js');
const { BrowserCampaignStore, isGameState } = require('../.test-build/storage.js');
const { canPlay, LOCAL_OWNER } = require('../.test-build/access.js');
const { getCommentary } = require('../.test-build/commentary.js');
const pool = require('../data/countries.json');

test('browser store retains independent campaigns, active battle and full event history', () => {
  const values = new Map();
  global.localStorage={setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)??null,removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}};
  const store=new BrowserCampaignStore();
  let s=createGame(pool,'za',()=>.5,'one');s.order=s.players.map(p=>p.id);
  s=transition(s,{type:'attack',actorId:'human',source:s.countries[0].code,target:s.countries[1].code},()=>.5).state;
  s=transition(s,{type:'roll',actorId:'human'},()=>.5).state;
  assert.equal(isGameState(s),true);store.save(s);
  assert.deepEqual(store.load('one'),s);
  assert.deepEqual(store.all(),[s]);
  assert.equal(store.load('one').phase,'battle');
  store.save(createGame(pool,'jp',()=>.3,'two'));assert.equal(store.list().length,2);
  store.remove('one');assert.equal(store.list().length,1);assert.equal(store.load('one'),null);
  values.set('orbis-victor:campaign:v1:bad','{"state":{}}');assert.equal(store.list().length,1);
  assert.equal(store.all().length,1);
  assert.throws(()=>store.load('bad'));
  delete global.localStorage;
});
test('save validation rejects unknown owners, invalid dice, broken phases and missing values', () => {
  const s=createGame(pool,'za',()=>.5,'validate');
  for(const modify of [
    s=>{s.countries[0].soldiers=0;},s=>{s.countries[0].ownerId='alien';},
    s=>{s.turnIndex=20;},s=>{s.order[0]='alien';},s=>{s.phase='battle';},
    s=>{s.phase='reinforce';s.reinforcements=0;},s=>{delete s.lastBattle;},
    s=>{s.winnerId='human';},s=>{s.lastBattle={};},s=>{s.events[0].text=17;},
  ]){const bad=structuredClone(s);modify(bad);assert.equal(isGameState(bad),false);}
});
test('spectator and non-owner capabilities cannot play, including during a human turn', () => {
  const s=createGame(pool,'za',()=>.5,'access');s.order=s.players.map(p=>p.id);
  assert.equal(canPlay(s,LOCAL_OWNER),true);
  assert.equal(canPlay(s,{role:'spectator',playerId:'human'}),false);
  assert.equal(canPlay(s,{role:'owner',playerId:'npc-1'}),false);
  s.turnIndex=1;assert.equal(canPlay(s,LOCAL_OWNER),false);
});
test('commentary service is async, local and deterministic', async () => {
  const result=getCommentary({id:1,source:'Kenya',target:'Norway',outcome:'tie'});
  assert.ok(result instanceof Promise);assert.match(await result,/stand their ground/);
});
