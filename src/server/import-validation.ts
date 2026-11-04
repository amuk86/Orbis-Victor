import countries from '../../data/countries.json';
import { currentPlayer, initialiseGame, transition } from '../game/engine';
import type { Action, GameState, RNG } from '../game/engine';
import { nextNpcAction } from '../game/npc';
import { isGameState } from '../game/storage';
import { ApiError } from './protocol';

function stable(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Historical local dice cannot be authenticated retroactively. Replay verifies internal
 * consistency; provenance stays local-import. Live commands never accept historical RNG. */
export function validateImport(value:unknown):GameState {
  if(!isGameState(value) || value.events.length>50_000)throw new ApiError(422,'This local save is invalid or too large. The original remains in this browser.');
  const saved=value;
  const selected=saved.countries.map(c=>{
    const canonical=countries.find(x=>x.code===c.code);
    if(!canonical || canonical.name!==c.name || canonical.population!==c.population)throw new ApiError(422,'The local country data does not match the supported snapshot.');
    return canonical;
  });
  let s=initialiseGame(selected,()=>.5,saved.id);
  s.order=[...saved.order];
  s.events[0]={...s.events[0],actorId:s.order[0],text:`${currentPlayer(s).name} takes the first turn.`};
  if(stable(s.events[0])!==stable(saved.events[0]))throw new ApiError(422,'The initial game record is inconsistent.');
  let pos=1;
  while(pos<saved.events.length) {
    const event=saved.events[pos];const p=currentPlayer(s);
    let action:Action|null=null;
    if(!p.human) action=nextNpcAction(s);
    else {
      if(event.kind==='reinforce') {
        const amount=Number(event.text.match(/\(\+(\d+)\)\.$/)?.[1]);
        const c=s.countries.find(c=>event.text===`${p.name} reinforces ${c.name} (+${amount}).`);
        if(c)action={type:'reinforce',actorId:p.id,country:c.code,amount};
      } else if(event.kind==='transfer') {
        const amount=Number(event.text.match(/: (\d+) soldiers\.$/)?.[1]);
        for(const a of s.countries)for(const d of s.countries)if(event.text===`${a.name} → ${d.name}: ${amount} soldiers.`)action={type:'transfer',actorId:p.id,source:a.code,target:d.code,amount};
      } else if(event.kind==='attack') {
        for(const a of s.countries)for(const d of s.countries)if(event.text===`${a.name} attacks ${d.name}.`)action={type:'attack',actorId:p.id,source:a.code,target:d.code};
      } else if(event.kind==='dice') action={type:'roll',actorId:p.id};
      else if(event.kind==='stop')action={type:'stop',actorId:p.id};
      else if(event.kind==='turn-end')action={type:'end',actorId:p.id};
    }
    if(!action)throw new ApiError(422,'The local history cannot be replayed by this rules version.');
    let rng:RNG=()=>{throw new ApiError(422,'Missing historical dice.');};
    if(action.type==='roll') {
      const battle=saved.events.slice(pos,pos+12).find(e=>e.kind==='battle')?.battle;
      if(!battle)throw new ApiError(422,'A battle record is missing.');
      const rolls=battle.attackerDice.flatMap((die,i)=>[die,battle.defenderDice[i]]);let n=0;
      rng=()=>{if(n>=rolls.length)throw new ApiError(422,'Historical dice do not match the rules.');return (rolls[n++]-1)/6;};
    }
    const result=transition(s,action,rng);
    if(result.error || stable(result.events)!==stable(saved.events.slice(pos,pos+result.events.length)))throw new ApiError(422,'The saved actions or dice are inconsistent with the game rules.');
    pos+=result.events.length;s=result.state;
  }
  if(stable(s)!==stable(saved))throw new ApiError(422,'The saved board does not match its replayed history. No data was uploaded as a playable campaign.');
  return s;
}
