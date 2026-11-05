import type {GameState} from '../game/engine';
import type {ReplayFrame} from './replay';

/** A board snapshot plus a contiguous range of history pages, not the entire log. */
export type CampaignView={
  id:string;ownerId:string;revision:number;eventCount:number;historyPages:number;
  provenance:string;state:GameState;firstPage:number;nextPage:number;hasMore:boolean;
};
export type MoveTiming={transactionMs:number;readMs:number;simulationMs:number;attempts:number;authMs:number;serverMs:number};
export type MoveResponse=CampaignView&{alreadyApplied:boolean;actions:number;frames?:ReplayFrame[];timings:MoveTiming};

export function mergeCampaignView(old:CampaignView|null,incoming:CampaignView):CampaignView{
  if(!old||old.id!==incoming.id)return incoming;
  const board=incoming.revision>=old.revision?incoming:old;
  const events=[...new Map([...old.state.events,...incoming.state.events].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
  // A move response can arrive after another tab's move. Never skip the gap in history.
  const nextPage=incoming.firstPage<=old.nextPage?Math.max(old.nextPage,incoming.nextPage):old.nextPage;
  return {...board,state:{...board.state,events},firstPage:Math.min(old.firstPage,incoming.firstPage),nextPage,hasMore:nextPage<board.historyPages};
}

export function needsCampaignRefresh(view:CampaignView|null,observedRevision:number,moving=false):boolean{
  return !moving&&(!view||view.revision<observedRevision||view.nextPage<view.historyPages);
}
