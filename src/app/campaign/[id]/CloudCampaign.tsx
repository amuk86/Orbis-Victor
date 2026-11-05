'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {doc,onSnapshot} from 'firebase/firestore';
import {firebase,firebaseConfigured} from '@/cloud/firebase';
import {cloudRequest,useAuth} from '@/cloud/auth';
import {mergeCampaignView,needsCampaignRefresh} from '@/cloud/campaign-state';
import type {CampaignView,MoveResponse} from '@/cloud/campaign-state';
import {FAST_REPLAY_MS,replayStates} from '@/cloud/replay';
import {allocationCommand,stageAllocation} from '@/cloud/reinforcements';
import type {AllocationCommand,AllocationDraft} from '@/cloud/reinforcements';
import {TransferBuffer} from '@/cloud/transfers';
import type {TransferStatus} from '@/cloud/transfers';
import type {Command,GameState} from '@/game/engine';
import GameClient from '../../game/demo/GameClient';
import '../../play/cloud.css';
type HumanAction=Command|{type:'launch';source:string;target:string};
const EMPTY_TRANSFERS:TransferStatus={state:null,ownerId:null,revision:null,moves:0,saving:false,error:''};
export default function CloudCampaign({id}:{id:string}){
  const auth=useAuth(),router=useRouter();
  const authUser=useRef(auth.user);authUser.current=auth.user;
  const [view,setView]=useState<CampaignView|null>(null),[pending,setPending]=useState(false),[syncing,setSyncing]=useState(false),[error,setError]=useState(''),[cached,setCached]=useState(false),[loading,setLoading]=useState(true);
  const [timing,setTiming]=useState<(MoveResponse['timings']&{requestMs:number;actions:number})|null>(null);
  const [playback,setPlayback]=useState<GameState|null>(null);
  const [allocation,setAllocation]=useState<AllocationDraft|null>(null);
  const allocationRef=useRef<AllocationDraft|null>(null);
  const [transfers,setTransfers]=useState<TransferStatus>(EMPTY_TRANSFERS),[transferGate,setTransferGate]=useState(false),[transferInputError,setTransferInputError]=useState(''),[waitingAction,setWaitingAction]=useState('');
  const transferBuffer=useRef<TransferBuffer|null>(null),transferSaving=useRef(false),transferBarrier=useRef(false),queuedAction=useRef<HumanAction|null>(null);
  const playbackPaused=useRef(false);
  const setPlaybackPaused=useCallback((paused:boolean)=>{playbackPaused.current=paused;},[]);
  const current=useRef<CampaignView|null>(null),inFlight=useRef<Promise<void>|null>(null),moving=useRef(false),readingOlder=useRef(false),epoch=useRef(0),observedRevision=useRef(-1);
  const accept=useCallback((incoming:CampaignView)=>{
    const merged=mergeCampaignView(current.current,incoming);current.current=merged;setView(merged);
  },[]);
  const refresh=useCallback(async()=>{
    if(inFlight.current)return inFlight.current;
    if(readingOlder.current)return;
    const generation=epoch.current;setSyncing(true);
    const work=(async()=>{
      try{
        do{
          const after=current.current?.nextPage;
          const result=await cloudRequest<CampaignView>(`/api/campaigns/${encodeURIComponent(id)}${after===undefined?'':`?after=${after}`}`);
          if(epoch.current!==generation)return;
          accept(result);
        }while(needsCampaignRefresh(current.current,observedRevision.current));
        setError('');
      }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:'Campaign could not be loaded.');}
      finally{if(epoch.current===generation){inFlight.current=null;setSyncing(false);setLoading(false);}}
    })();
    inFlight.current=work;return work;
  },[id,accept]);
  const makeTransferBuffer=useCallback(()=>{
    const generation=epoch.current;
    return new TransferBuffer({
      requestId:()=>crypto.randomUUID(),
      save:async attempt=>{
        if(inFlight.current)await inFlight.current;
        const user=authUser.current;
        if(epoch.current!==generation||!user||user.uid!==attempt.ownerId)throw new Error('Sign in as the campaign owner before saving transfers.');
        moving.current=true;transferSaving.current=true;
        const start=performance.now();
        const result=await cloudRequest<MoveResponse>(`/api/campaigns/${id}/commands`,{method:'POST',user,body:{revision:attempt.revision,requestId:attempt.requestId,command:attempt.command}});
        if(epoch.current===generation)setTiming({...result.timings,requestMs:performance.now()-start,actions:result.actions});
        return result;
      },
      confirmed:result=>{if(epoch.current===generation){accept(result);setError('');}},
      changed:status=>{
        if(epoch.current!==generation)return;
        setTransfers(status);
        if(!status.saving&&transferSaving.current){
          transferSaving.current=false;moving.current=false;
          if(!status.error&&needsCampaignRefresh(current.current,observedRevision.current))void refresh();
        }
      },
    });
  },[id,accept,refresh]);
  useEffect(()=>{
    current.current=null;inFlight.current=null;observedRevision.current=-1;moving.current=false;readingOlder.current=false;playbackPaused.current=false;
    allocationRef.current=null;setAllocation(null);
    transferBuffer.current=makeTransferBuffer();setTransfers(EMPTY_TRANSFERS);transferSaving.current=false;transferBarrier.current=false;queuedAction.current=null;setTransferGate(false);setWaitingAction('');setTransferInputError('');
    setView(null);setLoading(true);setError('');setTiming(null);setPending(false);setSyncing(false);setPlayback(null);
    if(!firebaseConfigured){setError('Firebase is not configured. Use the local demo or follow docs/FIREBASE.md.');setLoading(false);return;}
    let unsubscribe:()=>void=()=>{};
    try{
      unsubscribe=onSnapshot(doc(firebase().db,'campaigns',id),{includeMetadataChanges:true},snapshot=>{
        setCached(snapshot.metadata.fromCache);
        if(!snapshot.exists() || snapshot.data()?.status!=='ready'){
          if(!snapshot.metadata.fromCache){setError('Campaign not found or deleted.');setView(null);current.current=null;setLoading(false);}return;
        }
        if(snapshot.metadata.fromCache)return;
        observedRevision.current=Math.max(observedRevision.current,snapshot.data()!.revision);
        // The command response supplies our own revision. Defer listener reads until it arrives.
        if(needsCampaignRefresh(current.current,observedRevision.current,moving.current))void refresh();
      },()=>{setError('Cloud viewing failed. Check your connection and that the supplied Firestore rules are configured.');setLoading(false);});
    }catch(e){setError(e instanceof Error?e.message:'Cloud initialization failed.');setLoading(false);}
    return()=>{epoch.current++;transferBuffer.current?.dispose();unsubscribe();};
  },[id,refresh,makeTransferBuffer]);
  useEffect(()=>{
    if(!auth.loading&&allocationRef.current&&allocationRef.current.ownerId!==auth.user?.uid){allocationRef.current=null;setAllocation(null);}
  },[auth.loading,auth.user?.uid]);
  useEffect(()=>{
    const buffer=transferBuffer.current;
    if(!auth.loading&&buffer?.status.ownerId&&buffer.status.ownerId!==auth.user?.uid){
      buffer.dispose();transferBuffer.current=makeTransferBuffer();setTransfers(EMPTY_TRANSFERS);
      if(transferSaving.current)moving.current=false;
      transferSaving.current=false;transferBarrier.current=false;queuedAction.current=null;setTransferGate(false);setWaitingAction('');setTransferInputError('');
    }
  },[auth.loading,auth.user?.uid,makeTransferBuffer]);
  const owner=!!auth.user&&auth.user.uid===view?.ownerId;
  async function execute(command:Command|AllocationCommand|{type:'npc-step'|'npc-batch'}|{type:'launch';source:string;target:string},attempt?:AllocationDraft,afterTransfers=false){
    const v=current.current,user=authUser.current;if(!v||!user||user.uid!==v.ownerId||moving.current||inFlight.current||readingOlder.current||v.hasMore||transferBuffer.current?.status.moves)return;
    if(attempt){if(!attempt.complete||allocationRef.current!==attempt||attempt.ownerId!==user.uid)return;}
    else if(allocationRef.current||!afterTransfers&&(error||cached))return;
    const generation=epoch.current,start=performance.now();let saved=false;
    moving.current=true;setPending(true);
    try{
      const result=await cloudRequest<MoveResponse>(`/api/campaigns/${id}/commands`,{method:'POST',user,body:{revision:attempt?.revision??v.revision,requestId:attempt?.requestId??crypto.randomUUID(),command}});
      if(epoch.current!==generation)return;
      setTiming({...result.timings,requestMs:performance.now()-start,actions:result.actions});saved=true;
      if(attempt&&allocationRef.current===attempt){allocationRef.current=null;setAllocation(null);}
      setError('');
      // Keep the confirmed board separate from the presentation until each action has been seen.
      if(result.frames?.length){
        setPlayback(v.state);accept(result);
        for(const frame of replayStates(v.state,result.state.events,result.frames)){
          while(playbackPaused.current&&epoch.current===generation)await new Promise<void>(resolve=>setTimeout(resolve,100));
          if(epoch.current!==generation)return;
          setPlayback(frame);
          await new Promise<void>(resolve=>setTimeout(resolve,FAST_REPLAY_MS));
        }
      }else accept(result);
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:'Save was not confirmed. Refresh before retrying.');}
    finally{
      if(epoch.current===generation){
        moving.current=false;setPending(false);setPlayback(null);
        if(saved&&needsCampaignRefresh(current.current,observedRevision.current))void refresh();
      }
    }
  }
  async function finishTransfers(retry=false){
    const buffer=transferBuffer.current;if(!buffer||transferBarrier.current)return;
    const generation=epoch.current;transferBarrier.current=true;setTransferGate(true);
    try{
      if(!await buffer.flush(retry)||epoch.current!==generation||transferBuffer.current!==buffer)return;
      if(needsCampaignRefresh(current.current,observedRevision.current))await refresh();
      const action=queuedAction.current;queuedAction.current=null;setWaitingAction('');
      if(action)await execute(action,undefined,true);
    }finally{if(epoch.current===generation&&transferBuffer.current===buffer){transferBarrier.current=false;setTransferGate(false);}}
  }
  async function performAction(command:HumanAction){
    if(transferBarrier.current)return;
    const status=transferBuffer.current?.status;
    if(status?.moves||status?.saving){
      queuedAction.current=command;setWaitingAction(command.type==='end'?'end turn':command.type==='launch'||command.type==='attack'?'attack':'action');
      await finishTransfers();
    }else await execute(command);
  }
  async function send(command:Command){
    if(command.type==='transfer'){
      const v=current.current,user=authUser.current,buffer=transferBuffer.current;
      if(!v||!user||user.uid!==v.ownerId||!buffer||allocationRef.current||transferBarrier.current||moving.current&&!buffer.status.saving||inFlight.current||readingOlder.current||v.hasMore||error||cached)return;
      try{buffer.enqueue(v,user.uid,{source:command.source,target:command.target,amount:command.amount??1});setTransferInputError('');}
      catch(e){setTransferInputError(e instanceof Error?e.message:'This troop could not be transferred.');}
      return;
    }
    if(command.type!=='reinforce'){await performAction(command);return;}
    const v=current.current;
    if(!v||!auth.user||auth.user.uid!==v.ownerId||moving.current||inFlight.current||readingOlder.current||v.hasMore||error||cached||allocationRef.current?.complete)return;
    try{
      const draft=stageAllocation(v,auth.user.uid,command.country,crypto.randomUUID(),allocationRef.current,command.amount??1);
      // Ref updates synchronously, so rapid clicks cannot overwrite each other.
      allocationRef.current=draft;setAllocation(draft);
      if(draft.complete)await execute(allocationCommand(draft),draft);
    }catch(e){setError(e instanceof Error?e.message:'This troop could not be placed.');}
  }
  async function reloadAllocation(){
    if(moving.current)return;
    transferBuffer.current?.dispose();transferBuffer.current=makeTransferBuffer();setTransfers(EMPTY_TRANSFERS);queuedAction.current=null;setWaitingAction('');setTransferInputError('');
    allocationRef.current=null;setAllocation(null);await refresh();
  }
  async function older(){
    const v=current.current;if(!v||!v.firstPage||inFlight.current||moving.current||readingOlder.current||transferBuffer.current?.status.moves)return;
    const generation=epoch.current;readingOlder.current=true;setSyncing(true);
    try{
      const page=await cloudRequest<CampaignView>(`/api/campaigns/${id}?before=${v.firstPage}`);
      if(epoch.current!==generation)return;
      // Older pages may include a newer board, but their cursor does not cover the intervening history.
      accept(page);
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:'Earlier history could not be loaded.');}
    finally{if(epoch.current===generation){readingOlder.current=false;setSyncing(false);if(needsCampaignRefresh(current.current,observedRevision.current))void refresh();}}
  }
  const busy=pending||syncing||transferGate;
  const ownAllocation=owner&&allocation?.ownerId===auth.user?.uid?allocation:null;
  const allocationChanged=!!ownAllocation&&ownAllocation.revision!==view?.revision;
  const ownTransfers=owner&&transfers.ownerId===auth.user?.uid&&transfers.moves?transfers:null;
  const transferChanged=!!ownTransfers&&!ownTransfers.saving&&ownTransfers.revision!==view?.revision;
  const transferNotice=ownTransfers?(ownTransfers.error?'Transfer save is unconfirmed. Retry saving before continuing.':transferChanged?'The saved campaign changed. Reload the saved board before continuing.':transferGate?'Saving transfers before your requested action…':ownTransfers.saving?'Saving transfers. You can continue moving troops.':'Transfers save automatically after you pause clicking.'):undefined;
  return <><header className="cloud-toolbar"><Link href="/play">Cloud campaigns</Link><span>{owner?'Owner controls':'Public spectator'} · {playback?'Playing moves…':pending?'Saving…':syncing?'Syncing…':ownTransfers?ownTransfers.saving?'Saving transfers…':'Transfers pending':ownAllocation?ownAllocation.complete?'Allocation unconfirmed':`Placing troops · ${ownAllocation.state.reinforcements} remaining · unsaved`:cached?'Offline / cached view':`Saved revision ${view?.revision??'—'}`}{view?.provenance==='local-import'?' · Legacy local import':''}</span><Link href="/account">{auth.user?'Account / sign out':'Sign in to your account'}</Link><button onClick={()=>void refresh()} disabled={busy||!!ownTransfers}>Refresh / reconnect</button>{view?.firstPage? <button disabled={busy||!!ownTransfers} onClick={()=>void older()}>Load earlier dispatches</button>:null}
      {timing&&<details><summary>Connection timing</summary><p>Last request: {Math.round(timing.requestMs)} ms · Server: {Math.round(timing.serverMs)} ms · Authentication: {Math.round(timing.authMs)} ms · Firestore transaction: {Math.round(timing.transactionMs)} ms · Simulation: {Math.round(timing.simulationMs)} ms · {timing.actions} actions · {timing.attempts} transaction attempts</p></details>}
    </header>
    {ownTransfers&&(ownTransfers.error||transferChanged)&&<aside className="cloud-notice" aria-label="Pending transfers"><p role="alert">{ownTransfers.error||'The saved campaign changed.'} Your transfers are still shown.{waitingAction?` Your ${waitingAction} is waiting for these transfers to save.`:''}</p><button disabled={busy||ownTransfers.saving} onClick={()=>void finishTransfers(true)}>Retry saving transfers</button><button disabled={busy||ownTransfers.saving} onClick={()=>void reloadAllocation()}>Reload saved board</button></aside>}
    {transferInputError&&<p className="cloud-error" role="alert">{transferInputError}</p>}
    {ownAllocation&&<aside className="cloud-notice" aria-label="Pending troop allocation"><p role="status">{pending?'Saving all troop placements…':ownAllocation.complete?'Your placements are retained. Retry saving before attacking or ending your turn.':'Place your remaining soldiers. All placements save automatically after the last one.'}{allocationChanged?' The saved campaign has changed. Retry to confirm an uncertain save, or reload the saved board.':''}</p>{ownAllocation.complete&&<button disabled={busy} onClick={()=>void execute(allocationCommand(ownAllocation),ownAllocation)}>Retry saving allocation</button>}<button disabled={busy} onClick={()=>void reloadAllocation()}>Reload saved board</button></aside>}
    {(error||auth.error)&&<p className="cloud-error" role="alert">{error||auth.error} {ownAllocation?'Your pending placements are still shown.':'Controls pause until a successful refresh.'}</p>}
    {loading?<main className="cloud-page"><p role="status">Loading the shared campaign…</p></main>:view?<GameClient remote={{state:playback??ownAllocation?.state??ownTransfers?.state??view.state,notice:transferNotice??(ownAllocation?(allocationChanged?'The saved board changed. Confirm your save or reload the saved board.':pending?'Saving your troop allocation…':ownAllocation.complete?'Your allocation save is unconfirmed. Retry saving to continue.':`Place ${ownAllocation.state.reinforcements} remaining soldiers. All placements save together.`):undefined),canControl:owner&&!error&&!cached&&!view.hasMore&&!transferChanged&&!ownTransfers?.error&&(!ownAllocation||!ownAllocation.complete&&!allocationChanged),pending:busy,send,npcStep:()=>execute({type:'npc-step'}),npcBatch:()=>execute({type:'npc-batch'}),setPlaybackPaused,launch:(source,target)=>performAction({type:'launch',source,target}),leave:()=>router.push('/play')}}/>:<main className="cloud-page"><Link href="/game/demo">Play the separate local demo</Link></main>}
  </>;
}
