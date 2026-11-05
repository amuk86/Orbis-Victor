import {HUMAN_ID,transition} from '../game/engine';
import type {GameState} from '../game/engine';
import {mergeCampaignView} from './campaign-state';
import type {CampaignView} from './campaign-state';

export const TRANSFER_IDLE_MS=400;
export const MAX_TRANSFER_MOVES=128;
export type TransferMove={source:string;target:string;amount:number};
export type TransferCommand={type:'transfer-batch';moves:TransferMove[]};
export type TransferAttempt={ownerId:string;revision:number;requestId:string;command:TransferCommand};
export type TransferStatus={state:GameState|null;ownerId:string|null;revision:number|null;moves:number;saving:boolean;error:string};
type Clock={now:()=>number;set:(work:()=>void,ms:number)=>unknown;clear:(handle:unknown)=>void};
type Options={
  save:(attempt:TransferAttempt)=>Promise<CampaignView>;
  changed:(status:TransferStatus)=>void;
  confirmed:(view:CampaignView)=>void;
  requestId:()=>string;
  clock?:Clock;
};
const clock:Clock={now:()=>Date.now(),set:(work,ms)=>setTimeout(work,ms),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
const preview=(state:GameState,move:TransferMove,offset:number)=>{
  const result=transition(state,{type:'transfer',actorId:HUMAN_ID,...move},()=>{throw new Error('Transfers must not use dice.');},offset);
  if(result.error)throw new Error(result.error);
  return result.state;
};

/** One confirmed base, an ordered pending suffix, and one immutable retry packet. */
export class TransferBuffer{
  private base:CampaignView|null=null;
  private moves:TransferMove[]=[];
  private state:GameState|null=null;
  private attempt:TransferAttempt|null=null;
  private flight:Promise<boolean>|null=null;
  private timer:unknown;
  private lastInput=0;
  private saving=false;
  private error='';
  private closed=false;
  private clock:Clock;
  constructor(private options:Options){this.clock=options.clock??clock;}
  get status():TransferStatus{return {state:this.state,ownerId:this.base?.ownerId??null,revision:this.base?.revision??null,moves:this.moves.length,saving:this.saving,error:this.error};}
  private emit(){if(!this.closed)this.options.changed(this.status);}
  private cancelTimer(){if(this.timer!==undefined)this.clock.clear(this.timer);this.timer=undefined;}
  private schedule(){
    this.cancelTimer();
    if(this.closed||!this.moves.length||this.flight||this.error)return;
    this.timer=this.clock.set(()=>{this.timer=undefined;void this.saveOne();},Math.max(0,this.lastInput+TRANSFER_IDLE_MS-this.clock.now()));
  }
  enqueue(view:CampaignView,uid:string,move:TransferMove){
    if(this.closed)throw new Error('This campaign is no longer open.');
    if(view.ownerId!==uid)throw new Error('Only the campaign owner can transfer troops.');
    if(this.error)throw new Error('Retry saving the pending transfers or reload the saved board.');
    if(this.base&&(this.base.id!==view.id||this.base.ownerId!==uid||this.base.revision!==view.revision))throw new Error('The saved campaign changed. Reload the saved board before transferring more troops.');
    if(this.moves.length>=MAX_TRANSFER_MOVES)throw new Error('Wait for this transfer batch to save before moving more troops.');
    const base=this.base??view;
    const next=preview(this.state??base.state,move,base.eventCount-base.state.events.length);
    this.base=base;this.state=next;this.moves=[...this.moves,{...move}];this.lastInput=this.clock.now();
    this.emit();this.schedule();
  }
  private saveOne():Promise<boolean>{
    if(this.flight)return this.flight;
    if(this.closed||this.error)return Promise.resolve(false);
    if(!this.base||!this.moves.length)return Promise.resolve(true);
    this.cancelTimer();
    const base=this.base;
    const attempt=this.attempt??{ownerId:base.ownerId,revision:base.revision,requestId:this.options.requestId(),command:{type:'transfer-batch' as const,moves:this.moves.map(move=>({...move}))}};
    this.attempt=attempt;this.saving=true;this.emit();
    const work=(async()=>{
      try{
        const result=await this.options.save(attempt);
        if(this.closed)return false;
        const confirmed=mergeCampaignView(base,result);
        // Clicks during the request were appended, never included in its retry packet.
        this.moves=this.moves.slice(attempt.command.moves.length);this.attempt=null;
        this.base=this.moves.length?confirmed:null;
        let next=confirmed.state;
        for(const move of this.moves)next=preview(next,move,confirmed.eventCount-confirmed.state.events.length);
        this.state=this.moves.length?next:null;
        this.options.confirmed(result);
        return true;
      }catch(e){if(!this.closed)this.error=e instanceof Error?e.message:'Transfer save was not confirmed. Retry before continuing.';return false;}
      finally{this.flight=null;this.saving=false;if(!this.closed){this.emit();this.schedule();}}
    })();
    this.flight=work;return work;
  }
  /** Used by attack/end-turn barriers and explicit retry. Drain every pending suffix first. */
  async flush(retry=false):Promise<boolean>{
    this.cancelTimer();
    if(retry){this.error='';this.emit();}
    while(!this.closed&&(this.moves.length||this.flight)){
      this.cancelTimer();
      if(this.error)return false;
      if(!await (this.flight??this.saveOne()))return false;
    }
    return !this.closed;
  }
  dispose(){this.closed=true;this.cancelTimer();}
}
