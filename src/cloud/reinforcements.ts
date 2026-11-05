import {HUMAN_ID,transition} from '../game/engine';
import type {GameState} from '../game/engine';
import type {CampaignView} from './campaign-state';

export type Placement={country:string;amount:number};
export type AllocationCommand={type:'reinforce-all';placements:Placement[]};
export type AllocationDraft={
  campaignId:string;ownerId:string;revision:number;requestId:string;eventOffset:number;
  placements:Placement[];state:GameState;complete:boolean;
};

/** Instant presentation only. The server independently validates every placement. */
export function stageAllocation(view:CampaignView,uid:string,country:string,requestId:string,draft:AllocationDraft|null=null,amount=1):AllocationDraft{
  if(view.ownerId!==uid)throw new Error('Only the campaign owner can place troops.');
  if(draft&&(draft.campaignId!==view.id||draft.ownerId!==uid||draft.revision!==view.revision))throw new Error('The saved campaign changed. Reload the saved board before placing more troops.');
  if(draft?.complete)throw new Error('The completed allocation is waiting to be saved.');
  const eventOffset=draft?.eventOffset??view.eventCount-view.state.events.length;
  const result=transition(draft?.state??view.state,{type:'reinforce',actorId:HUMAN_ID,country,amount},()=>{throw new Error('Reinforcements must not use dice.');},eventOffset);
  if(result.error)throw new Error(result.error);
  return {campaignId:view.id,ownerId:uid,revision:view.revision,requestId:draft?.requestId??requestId,eventOffset,
    placements:[...(draft?.placements??[]),{country,amount}],state:result.state,complete:result.state.reinforcements===0};
}

export function allocationCommand(draft:AllocationDraft):AllocationCommand{
  if(!draft.complete)throw new Error('Place all available troops before saving the allocation.');
  return {type:'reinforce-all',placements:draft.placements};
}
