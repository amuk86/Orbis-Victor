const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGame,transition}=require('../.test-build/engine.js');
const {analyseCampaign,aggregateCampaigns}=require('../.test-build/analytics.js');
const pool=require('../data/countries.json');
function fixture(id='analytics') {
  const s=createGame(pool,'za',()=>.5,id);s.order=s.players.map(p=>p.id);
  s.countries[0].soldiers=3;s.countries[1].soldiers=2;return s;
}
function fight(s,rolls) {
  const actorId=s.order[s.turnIndex];
  let n=0;
  s=transition(s,{type:'attack',actorId,source:s.countries[s.turnIndex].code,target:s.countries[s.turnIndex===0?1:0].code},()=>.5).state;
  return transition(s,{type:'roll',actorId},()=>rolls[n++%rolls.length]).state;
}
test('analytics empty state has no fictional counts or divide-by-zero win rate',()=>{
  const a=aggregateCampaigns([]);
  assert.equal(a.platform.campaigns,0);assert.equal(a.player.winRate,null);
  assert.deepEqual(a.player.diceFaces,[0,0,0,0,0,0]);assert.deepEqual(a.countries,[]);
});
test('analytics counts structured battle data once and attributes both sides correctly',()=>{
  const s=fight(fixture(),[0,1/6,3/6,2/6]);
  const before=JSON.stringify(s);const a=analyseCampaign(s);
  assert.equal(JSON.stringify(s),before);
  assert.equal(a.attacks,1);assert.equal(a.battleRounds,1);assert.equal(a.diceRolled,4);
  assert.equal(a.soldiersLost,2);assert.equal(a.human.enemyLosses,1);assert.equal(a.human.soldiersLost,1);
  assert.equal(a.human.diceWins,1);assert.equal(a.human.diceLosses,1);assert.equal(a.human.diceTies,0);
  assert.deepEqual(a.human.diceFaces,[1,0,0,1,0,0]);
  assert.equal(a.commanders[1].soldiersLost,1);assert.equal(a.commanders[1].enemyLosses,1);
  const repeated={...s,events:[...s.events,s.events.at(-1)]};
  assert.equal(analyseCampaign(repeated).battleRounds,1);
});
test('player defensive dice and casualties are attributed to the human, not the NPC',()=>{
  const s=fixture();s.turnIndex=1;s.countries[1].soldiers=3;s.countries[0].soldiers=2;
  const a=analyseCampaign(fight(s,[.99,0,0,.99]));
  assert.equal(a.human.attacks,0);assert.equal(a.human.diceRolled,2);
  assert.equal(a.human.diceWins,1);assert.equal(a.human.diceLosses,1);
  assert.deepEqual(a.human.diceFaces,[1,0,0,0,0,1]);
});
test('ties count dice but create no casualties; no redundant dice/loss log counts',()=>{
  const a=analyseCampaign(fight(fixture(),[.5]));
  assert.equal(a.human.diceTies,2);assert.equal(a.human.diceRolled,2);
  assert.equal(a.soldiersLost,0);assert.equal(a.battleRounds,1);
});
test('conquests and eliminations are credited to their actor, independently of current owner',()=>{
  const s=fixture();s.countries[1].soldiers=1;
  const a=analyseCampaign(fight(s,[.99,0]));
  assert.equal(a.human.conquests,1);assert.equal(a.human.eliminations,1);
  assert.equal(a.human.territories,2);assert.equal(a.commanders[1].territories,0);
  assert.equal(a.conquests,1);
});
test('win rate excludes unfinished games and distinguishes a human loss from a finished world',()=>{
  const won=fixture('win');won.countries.forEach(c=>c.ownerId='human');won.winnerId='human';won.phase='finished';
  const lost=fixture('loss');lost.countries[0].ownerId='npc-1'; // Human out, but NPC war continues.
  const active=fixture('active');
  const a=aggregateCampaigns([won,lost,active]);
  assert.equal(a.player.wins,1);assert.equal(a.player.losses,1);assert.equal(a.player.active,1);
  assert.equal(a.player.winRate,50);assert.equal(a.platform.worldFinished,1);assert.equal(a.platform.ongoingWars,2);
  assert.deepEqual(a.countries,[{code:'za',name:'South Africa',campaigns:3,wins:1,losses:1,active:1}]);
});
test('resaved campaigns replace prior snapshots and never inflate lifetime totals',()=>{
  const original=fixture('same');const updated=fight(original,[.99,0]);
  const a=aggregateCampaigns([original,updated,updated]);
  assert.equal(a.platform.campaigns,1);assert.equal(a.platform.attacks,1);
  assert.equal(a.platform.battleRounds,1);assert.equal(a.player.diceRolled,2);
});
test('local platform includes NPC actions and legacy saves do not require new event fields',()=>{
  const s=fixture();s.turnIndex=1;s.countries[1].soldiers=3;s.countries[0].soldiers=2;
  const command={type:'attack',actorId:'npc-1',source:s.countries[1].code,target:s.countries[0].code,reason:'Favourable odds.'};
  const next=transition(s,command,()=>.5).state;
  const a=aggregateCampaigns([JSON.parse(JSON.stringify(next))]);
  assert.equal(a.platform.npcDecisions,1);assert.equal(a.platform.attacks,1);assert.equal(a.player.attacks,0);
});
