import type {GameEvent,GameState} from '../game/engine';

/** Server-generated changes after one NPC action. Events stay in the shared response log. */
export type ReplayFrame={patch:Partial<Omit<GameState,'events'>>;eventId:number};
export const FAST_REPLAY_MS=170;

export function replayFrame(previous:GameState,next:GameState):ReplayFrame{
  const patch=Object.fromEntries(Object.entries(next).filter(([key,value])=>key!=='events'&&JSON.stringify(value)!==JSON.stringify(previous[key as keyof GameState])));
  return {patch,eventId:next.events.at(-1)?.id??0};
}

/** Display committed server results only; never generate decisions or dice in the browser. */
export function* replayStates(initial:GameState,events:GameEvent[],frames:ReplayFrame[]):Generator<GameState>{
  let state=initial,index=0;
  for(const frame of frames){
    const added:GameEvent[]=[];
    while(index<events.length&&events[index].id<=frame.eventId)added.push(events[index++]);
    state={...state,...frame.patch,events:[...state.events,...added]};
    yield state;
  }
}
