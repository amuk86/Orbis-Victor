import type { GameEvent } from '../game/engine';
import { ApiError } from './protocol';
export type HistoryPage = {seq:number;firstId:number;lastId:number;json:string};
/** Small, index-exempt JSON pages. A long event log never grows the board document. */
export function historyPages(events:GameEvent[], start=0):HistoryPage[] {
  const groups:GameEvent[][]=[];let group:GameEvent[]=[];let bytes=2;
  for(const event of events) {
    const size=Buffer.byteLength(JSON.stringify(event),'utf8')+1;
    if(size>500_000)throw new ApiError(413,'A single battle record is too large to persist safely. No move was committed.');
    if(group.length && bytes+size>60_000){groups.push(group);group=[];bytes=2;}
    group.push(event);bytes+=size;
  }
  if(group.length)groups.push(group);
  return groups.map((g,i)=>({seq:start+i,firstId:g[0].id,lastId:g[g.length-1].id,json:JSON.stringify(g)}));
}
export const pageId=(seq:number)=>String(seq).padStart(12,'0');
