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
import type {Command,GameState} from '@/game/engine';
import GameClient from '../../game/demo/GameClient';
import '../../play/cloud.css';
export default function CloudCampaign({id}:{id:string}){
  const auth=useAuth(),router=useRouter();
  const [view,setView]=useState<CampaignView|null>(null),[pending,setPending]=useState(false),[syncing,setSyncing]=useState(false),[error,setError]=useState(''),[cached,setCached]=useState(false),[loading,setLoading]=useState(true);
  const [timing,setTiming]=useState<(MoveResponse['timings']&{requestMs:number;actions:number})|null>(null);
  const [playback,setPlayback]=useState<GameState|null>(null);
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
  useEffect(()=>{
    current.current=null;inFlight.current=null;observedRevision.current=-1;moving.current=false;readingOlder.current=false;playbackPaused.current=false;
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
    return()=>{epoch.current++;unsubscribe();};
  },[id,refresh]);
  const owner=!!auth.user&&auth.user.uid===view?.ownerId;
  async function execute(command:Command|{type:'npc-step'|'npc-batch'}|{type:'launch';source:string;target:string}){
    const v=current.current;if(!v||!auth.user||auth.user.uid!==v.ownerId||moving.current||inFlight.current||readingOlder.current||v.hasMore||error||cached)return;
    const generation=epoch.current,start=performance.now();let saved=false;
    moving.current=true;setPending(true);
    try{
      const result=await cloudRequest<MoveResponse>(`/api/campaigns/${id}/commands`,{method:'POST',user:auth.user,body:{revision:v.revision,requestId:crypto.randomUUID(),command}});
      if(epoch.current!==generation)return;
      setTiming({...result.timings,requestMs:performance.now()-start,actions:result.actions});saved=true;
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
  async function older(){
    const v=current.current;if(!v||!v.firstPage||inFlight.current||moving.current||readingOlder.current)return;
    const generation=epoch.current;readingOlder.current=true;setSyncing(true);
    try{
      const page=await cloudRequest<CampaignView>(`/api/campaigns/${id}?before=${v.firstPage}`);
      if(epoch.current!==generation)return;
      // Older pages may include a newer board, but their cursor does not cover the intervening history.
      accept(page);
    }catch(e){if(epoch.current===generation)setError(e instanceof Error?e.message:'Earlier history could not be loaded.');}
    finally{if(epoch.current===generation){readingOlder.current=false;setSyncing(false);if(needsCampaignRefresh(current.current,observedRevision.current))void refresh();}}
  }
  const busy=pending||syncing;
  return <><header className="cloud-toolbar"><Link href="/play">Cloud campaigns</Link><span>{owner?'Owner controls':'Public spectator'} · {playback?'Playing moves…':pending?'Saving…':syncing?'Syncing…':cached?'Offline / cached view':`Saved revision ${view?.revision??'—'}`}{view?.provenance==='local-import'?' · Legacy local import':''}</span><Link href="/account">{auth.user?'Account / sign out':'Sign in to your account'}</Link><button onClick={()=>void refresh()} disabled={busy}>Refresh / reconnect</button>{view?.firstPage? <button disabled={busy} onClick={()=>void older()}>Load earlier dispatches</button>:null}
      {timing&&<details><summary>Connection timing</summary><p>Last request: {Math.round(timing.requestMs)} ms · Server: {Math.round(timing.serverMs)} ms · Authentication: {Math.round(timing.authMs)} ms · Firestore transaction: {Math.round(timing.transactionMs)} ms · Simulation: {Math.round(timing.simulationMs)} ms · {timing.actions} actions · {timing.attempts} transaction attempts</p></details>}
    </header>
    {(error||auth.error)&&<p className="cloud-error" role="alert">{error||auth.error} Controls pause until a successful refresh.</p>}
    {loading?<main className="cloud-page"><p role="status">Loading the shared campaign…</p></main>:view?<GameClient remote={{state:playback??view.state,canControl:owner&&!error&&!cached&&!view.hasMore,pending:busy,send:execute,npcStep:()=>execute({type:'npc-step'}),npcBatch:()=>execute({type:'npc-batch'}),setPlaybackPaused,launch:(source,target)=>execute({type:'launch',source,target}),leave:()=>router.push('/play')}}/>:<main className="cloud-page"><Link href="/game/demo">Play the separate local demo</Link></main>}
  </>;
}
