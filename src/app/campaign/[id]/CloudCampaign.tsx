'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {doc,onSnapshot} from 'firebase/firestore';
import {firebase,firebaseConfigured} from '@/cloud/firebase';
import {cloudRequest,useAuth} from '@/cloud/auth';
import type {Command,GameState} from '@/game/engine';
import GameClient from '../../game/demo/GameClient';
import '../../play/cloud.css';
type View={id:string;ownerId:string;revision:number;eventCount:number;historyPages:number;provenance:string;state:GameState;firstPage:number;nextPage:number;hasMore:boolean};
export default function CloudCampaign({id}:{id:string}){
  const auth=useAuth(),router=useRouter();
  const [view,setView]=useState<View|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[cached,setCached]=useState(false),[loading,setLoading]=useState(true);
  const current=useRef<View|null>(null),reading=useRef(false),again=useRef(false),moving=useRef(false),alive=useRef(true);
  const refreshWaiters=useRef<Array<()=>void>>([]);
  const refresh=useCallback(async()=>{
    if(reading.current){again.current=true;await new Promise<void>(resolve=>refreshWaiters.current.push(resolve));return;}
    reading.current=true;
    try{
      let after=current.current?.nextPage;
      do{
        const result=await cloudRequest<View>(`/api/campaigns/${encodeURIComponent(id)}${after===undefined?'':`?after=${after}`}`);
        if(!alive.current)return;
        const old=current.current;
        const events=[...new Map([...(old?.state.events??[]),...result.state.events].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
        const merged={...result,state:{...result.state,events},firstPage:old?Math.min(old.firstPage,result.firstPage):result.firstPage};
        current.current=merged;setView(merged);after=result.nextPage;
        if(!result.hasMore)break;
      }while(true);
      setError('');
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Campaign could not be loaded.');}
    finally{reading.current=false;if(alive.current)setLoading(false);if(again.current&&alive.current){again.current=false;await refresh();}for(const resolve of refreshWaiters.current.splice(0))resolve();}
  },[id]);
  useEffect(()=>{
    alive.current=true;current.current=null;setView(null);setLoading(true);
    if(!firebaseConfigured){setError('Firebase is not configured. Use the local demo or follow docs/FIREBASE.md.');setLoading(false);return;}
    let unsubscribe:()=>void=()=>{};
    try{
      unsubscribe=onSnapshot(doc(firebase().db,'campaigns',id),{includeMetadataChanges:true},snapshot=>{
        setCached(snapshot.metadata.fromCache);
        if(!snapshot.exists() || snapshot.data()?.status!=='ready'){
          if(!snapshot.metadata.fromCache){setError('Campaign not found or deleted.');setView(null);current.current=null;setLoading(false);}return;
        }
        if(snapshot.metadata.fromCache)return;
        if(current.current?.revision!==snapshot.data()!.revision)void refresh();
      },()=>{setError('Cloud viewing failed. Check your connection and that the supplied Firestore rules are configured.');setLoading(false);});
    }catch(e){setError(e instanceof Error?e.message:'Cloud initialization failed.');setLoading(false);}
    return()=>{alive.current=false;unsubscribe();};
  },[id,refresh]);
  const owner=!!auth.user&&auth.user.uid===view?.ownerId;
  async function execute(command:Command|{type:'npc-step'}|{type:'launch';source:string;target:string}){
    const v=current.current;if(!v||!auth.user||auth.user.uid!==v.ownerId||moving.current||error||cached)return;
    moving.current=true;setPending(true);
    try{await cloudRequest(`/api/campaigns/${id}/commands`,{method:'POST',user:auth.user,body:{revision:v.revision,requestId:crypto.randomUUID(),command}});await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Save was not confirmed. Refresh before retrying.');}
    finally{moving.current=false;setPending(false);}
  }
  async function older(){
    const v=current.current;if(!v||!v.firstPage||reading.current)return;
    reading.current=true;setPending(true);
    try{
      const page=await cloudRequest<View>(`/api/campaigns/${id}?before=${v.firstPage}`);
      const latest=current.current!;
      const events=[...new Map([...page.state.events,...latest.state.events].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
      const merged={...latest,firstPage:page.firstPage,state:{...latest.state,events}};current.current=merged;setView(merged);
    }catch(e){setError(e instanceof Error?e.message:'Earlier history could not be loaded.');}
    finally{reading.current=false;setPending(false);if(again.current){again.current=false;void refresh();}}
  }
  return <><header className="cloud-toolbar"><Link href="/play">Cloud campaigns</Link><span>{owner?'Owner controls':'Public spectator'} · {pending?'Saving…':cached?'Offline / cached view':`Saved revision ${view?.revision??'—'}`}{view?.provenance==='local-import'?' · Legacy local import':''}</span><Link href="/account">{auth.user?'Account / sign out':'Sign in to your account'}</Link><button onClick={()=>void refresh()} disabled={pending}>Refresh / reconnect</button>{view?.firstPage? <button disabled={pending} onClick={()=>void older()}>Load earlier dispatches</button>:null}</header>
    {(error||auth.error)&&<p className="cloud-error" role="alert">{error||auth.error} Controls pause until a successful refresh.</p>}
    {loading?<main className="cloud-page"><p role="status">Loading the shared campaign…</p></main>:view?<GameClient remote={{state:view.state,canControl:owner&&!error&&!cached,pending,send:execute,npcStep:()=>execute({type:'npc-step'}),launch:(source,target)=>execute({type:'launch',source,target}),leave:()=>router.push('/play')}}/>:<main className="cloud-page"><Link href="/game/demo">Play the separate local demo</Link></main>}
  </>;
}
