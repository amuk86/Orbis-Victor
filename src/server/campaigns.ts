import { createHash, randomInt } from 'node:crypto';
import type { Transaction } from 'firebase-admin/firestore';
import countries from '../../data/countries.json';
import { createGame, owned, HUMAN_ID } from '../game/engine';
import type { GameState } from '../game/engine';
import { admin } from './firebase-admin';
import { ApiError, applyCommand, requireOwner } from './protocol';
import type { CampaignRecord, CloudCommand } from './protocol';
import { historyPages, pageId } from './history';
import type {CampaignView} from '../cloud/campaign-state';

function viewOf(id:string,c:CampaignRecord,events:GameState['events'],firstPage:number,nextPage:number):CampaignView {
  return {id,ownerId:c.ownerId,revision:c.revision,eventCount:c.eventCount,historyPages:c.historyPages,provenance:c.provenance,state:{...c.state,events},firstPage,nextPage,hasMore:nextPage<c.historyPages};
}

export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export const rng=()=>randomInt(0,0x100000000)/0x100000000;
export function campaignId(id:string) { if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw new ApiError(400,'Invalid campaign URL.');return id; }
export function snapshot(state:GameState):Omit<GameState,'events'> {
  const {events,...core}=state;void events;
  if(Buffer.byteLength(JSON.stringify(core))>200_000)throw new ApiError(413,'The board exceeds the safe snapshot size. No progress was overwritten.');
  return core;
}
export function persistNew(tx:Transaction, id:string, uid:string, state:GameState, provenance:CampaignRecord['provenance']) {
  const db=admin().db,ref=db.collection('campaigns').doc(id),pages=historyPages(state.events);
  const now=new Date().toISOString();
  const record:CampaignRecord={ownerId:uid,revision:0,eventCount:state.events.length,historyPages:pages.length,state:snapshot(state),status:'ready',provenance,createdAt:now,updatedAt:now,lastRequestId:'',lastRequestHash:''};
  tx.create(ref,record);
  for(const page of pages)tx.create(ref.collection('history').doc(pageId(page.seq)),page);
  return record;
}
export async function createCampaign(uid:string,country:string,requestId:string) {
  if(!countries.some(c=>c.code===country))throw new ApiError(400,'Choose a listed country.');
  const id=digest(`${uid}:create:${requestId}`).slice(0,48),db=admin().db,ref=db.collection('campaigns').doc(id);
  await db.runTransaction(async tx=>{
    const existing=await tx.get(ref);
    if(existing.exists){const record=existing.data() as CampaignRecord;requireOwner(record,uid);if(record.state.countries[0].code!==country)throw new ApiError(409,'This request ID was already used.');return;}
    persistNew(tx,id,uid,createGame(countries,country,rng,id),'cloud');
  });
  return {id,url:`/campaign/${id}`};
}
export async function listCampaigns(uid:string,after?:string) {
  const db=admin().db;
  let q=db.collection('campaigns').where('ownerId','==',uid).where('status','==','ready').orderBy('updatedAt','desc').orderBy('__name__','desc').limit(30);
  if(after) {
    const cursor=await db.collection('campaigns').doc(campaignId(after)).get();
    if(!cursor.exists || cursor.data()?.ownerId!==uid)throw new ApiError(400,'Invalid list cursor.');
    q=q.startAfter(cursor);
  }
  const docs=await q.get();
  return {campaigns:docs.docs.map(d=>{
    const c=d.data() as CampaignRecord;
    return {id:d.id,country:c.state.countries[0].name,round:c.state.round,revision:c.revision,updatedAt:c.updatedAt,provenance:c.provenance,territories:owned({...c.state,events:[]},HUMAN_ID).length,finished:c.state.phase==='finished'||!c.state.countries.some(x=>x.ownerId===HUMAN_ID)};
  }),next:docs.size===30?docs.docs.at(-1)!.id:null};
}
export async function publicCampaign(id:string,options:{after?:number;before?:number;known?:number}={}) {
  const ref=admin().db.collection('campaigns').doc(campaignId(id));
  const doc=await ref.get();
  if(!doc.exists || doc.data()?.status!=='ready')throw new ApiError(404,'Campaign not found. It may have been deleted.');
  const c=doc.data() as CampaignRecord;
  if(options.known===c.revision && options.after===undefined && options.before===undefined)return {unchanged:true,revision:c.revision};
  const end=options.before===undefined?c.historyPages:Math.min(options.before,c.historyPages);
  const start=options.after===undefined?Math.max(0,end-20):Math.min(options.after,end);
  const pages=await ref.collection('history').where('seq','>=',start).where('seq','<',end).orderBy('seq').limit(20).get();
  const events=pages.docs.flatMap(d=>JSON.parse(d.data().json));
  const nextPage=pages.size?pages.docs.at(-1)!.data().seq+1:start;
  return {...viewOf(id,c,events,start,nextPage),hasMore:nextPage<end};
}
export async function moveCampaign(id:string,uid:string,revision:number,command:CloudCommand,requestId:string) {
  const ref=admin().db.collection('campaigns').doc(campaignId(id)),requestHash=digest(JSON.stringify(command));
  const start=performance.now();let readMs=0,simulationMs=0,attempts=0;
  const response=await admin().db.runTransaction(async tx=>{
    attempts++;let mark=performance.now();
    const doc=await tx.get(ref);
    readMs+=performance.now()-mark;
    if(!doc.exists)throw new ApiError(404,'Campaign not found.');
    const c=doc.data() as CampaignRecord;
    requireOwner(c,uid);
    if(c.lastRequestId===requestId) {
      if(c.lastRequestHash!==requestHash)throw new ApiError(409,'A request ID cannot be reused for another command.');
      const first=c.lastRequestFirstPage??c.historyPages;
      mark=performance.now();
      const pages=await tx.get(ref.collection('history').where('seq','>=',first).where('seq','<',c.historyPages).orderBy('seq'));
      readMs+=performance.now()-mark;
      return {...viewOf(id,c,pages.docs.flatMap(p=>JSON.parse(p.data().json)),first,c.historyPages),alreadyApplied:true,actions:0};
    }
    mark=performance.now();
    const result=applyCommand(c,uid,revision,command,rng);
    const pages=historyPages(result.events,c.historyPages);
    const update={state:snapshot(result.state),revision:c.revision+1,eventCount:c.eventCount+result.events.length,historyPages:c.historyPages+pages.length,updatedAt:new Date().toISOString(),lastRequestId:requestId,lastRequestHash:requestHash,lastRequestFirstPage:c.historyPages};
    simulationMs+=performance.now()-mark;
    tx.update(ref,update);
    for(const page of pages)tx.create(ref.collection('history').doc(pageId(page.seq)),page);
    return {...viewOf(id,{...c,...update},result.events,c.historyPages,update.historyPages),alreadyApplied:false,actions:result.actions,...(result.frames?{frames:result.frames}:{})};
  });
  return {...response,timings:{transactionMs:performance.now()-start,readMs,simulationMs,attempts}};
}
export async function deleteCampaign(id:string,uid:string,revision:number) {
  const db=admin().db,ref=db.collection('campaigns').doc(campaignId(id));
  await db.runTransaction(async tx=>{
    const doc=await tx.get(ref);if(!doc.exists)return;
    const c=doc.data() as CampaignRecord;
    if(c.ownerId!==uid)throw new ApiError(403,'Only the owner can delete this campaign.');
    if(c.status==='ready' && c.revision!==revision)throw new ApiError(409,'The campaign changed. Refresh before deleting.');
    tx.update(ref,{status:'deleting',revision:c.revision+1});
  });
  // Block readers/moves first. Retrying a partial cleanup is safe; subcollections are removed too.
  await db.recursiveDelete(ref);
  return {deleted:true};
}
