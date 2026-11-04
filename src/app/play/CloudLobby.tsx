'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import countries from '../../../data/countries.json';
import {cloudRequest,useAuth} from '@/cloud/auth';
import {BrowserCampaignStore} from '@/game/storage';
import type {GameState} from '@/game/engine';
import './cloud.css';
type Summary={id:string;country:string;round:number;revision:number;territories:number;finished:boolean;provenance:string};
export default function CloudLobby(){
  const auth=useAuth(),router=useRouter();
  const [campaigns,setCampaigns]=useState<Summary[]>([]),[country,setCountry]=useState('za'),[next,setNext]=useState<string|null>(null);
  const [listError,setListError]=useState(''),[listLoaded,setListLoaded]=useState(false);
  const [local,setLocal]=useState<GameState[]>([]),[consent,setConsent]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[loading,setLoading]=useState(false);
  const createId=useRef<{uid:string;country:string;id:string}|null>(null);
  const refresh=useCallback(async(after?:string)=>{
    if(!auth.user)return;setLoading(true);setListError('');
    try{const result=await cloudRequest<{campaigns:Summary[];next:string|null}>(`/api/campaigns${after?`?after=${encodeURIComponent(after)}`:''}`,{user:auth.user});setCampaigns(old=>after?[...old,...result.campaigns]:result.campaigns);setNext(result.next);setListLoaded(true);}
    catch(e){setListError(e instanceof Error?e.message:'Campaigns could not be loaded.');}finally{setLoading(false);}
  },[auth.user]);
  useEffect(()=>{setCampaigns([]);setNext(null);setListLoaded(false);setListError('');setMessage('');setConsent(false);if(auth.user)void refresh();},[auth.user,refresh]);
  async function create(){
    if(!auth.user)return;setPending(true);setMessage('');
    if(createId.current?.uid!==auth.user.uid || createId.current.country!==country)createId.current={uid:auth.user.uid,country,id:crypto.randomUUID()};
    try{const result=await cloudRequest<{url:string}>('/api/campaigns',{method:'POST',user:auth.user,body:{country,requestId:createId.current.id}});createId.current=null;router.push(result.url);}
    catch(e){setMessage(e instanceof Error?e.message:'Creation failed.');}finally{setPending(false);}
  }
  async function importLocal(state:GameState){
    if(!auth.user||!consent)return;setPending(true);setMessage('Preparing your explicitly selected local save…');
    try{
      const bytes=new TextEncoder().encode(JSON.stringify(state));
      if(bytes.length>6_000_000)throw new Error('This save is larger than the supported 6 MB import size. It has not been removed or changed.');
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const chunks=Math.ceil(bytes.length/48_000);
      const session=await cloudRequest<{id:string;status:string;campaignId:string}>('/api/imports',{method:'POST',user:auth.user,body:{localId:state.id,digest:hash,bytes:bytes.length,chunks,consent:true}});
      if(session.status!=='complete')for(let index=0;index<chunks;index++){
        const slice=bytes.slice(index*48_000,(index+1)*48_000);let binary='';for(const b of slice)binary+=String.fromCharCode(b);
        setMessage(`Uploading selected save: part ${index+1} of ${chunks}. The original remains in this browser.`);
        await cloudRequest(`/api/imports/${session.id}`,{method:'POST',user:auth.user,body:{index,data:btoa(binary)}});
      }
      const complete=await cloudRequest<{id:string;url:string;alreadyImported:boolean}>(`/api/imports/${session.id}`,{method:'PUT',user:auth.user});
      const confirmed=await cloudRequest<{id:string;eventCount:number}>(`/api/campaigns/${complete.id}`);
      if(confirmed.id!==complete.id)throw new Error('Cloud confirmation failed. Your original local save remains available.');
      setMessage(complete.alreadyImported?'This save was already imported. Opening its existing cloud copy; later offline changes are not merged. The original remains available.':'Cloud campaign confirmed. Your original browser save has been retained.');await refresh();router.push(complete.url);
    }catch(e){setMessage(e instanceof Error?e.message:'Import failed. Your original remains in this browser.');}finally{setPending(false);}
  }
  return <main className="cloud-page"><section className="cloud-panel"><Link href="/">← Title screen</Link><h1>Your cloud campaigns</h1><p className="cloud-mode">Cloud mode · server-controlled moves · public campaign links</p><div className="cloud-actions"><Link className="cloud-button" href="/game/demo">Local development / demo</Link><Link className="cloud-button" href="/analytics">Local analytics</Link><Link className="cloud-button" href="/account">{auth.user?'Account':'Sign in / create account'}</Link></div>
    {!auth.configured?<p className="cloud-notice">Cloud services are not configured. Follow <code>docs/FIREBASE.md</code>. The local demo works independently.</p>:auth.loading?<p role="status">Checking your session…</p>:!auth.user?<p>Sign in to create, import, or manage campaigns. Anyone with a campaign link can watch without an account.</p>:<>
      <p>Signed in as {auth.user.email??'commander'}. Campaign state and dispatch history are visible to anyone with its link.</p><button disabled={pending} onClick={()=>void auth.signOut().catch(()=>setMessage('Sign-out failed. Please retry.'))}>Sign out</button>
      <label>Starting country<select value={country} disabled={pending} onChange={e=>setCountry(e.target.value)}>{countries.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label><button disabled={pending} onClick={()=>void create()}>{pending?'Saving…':'Start cloud campaign'}</button><button disabled={pending||loading} onClick={()=>void refresh()}>Refresh campaigns</button>
      <h2>Saved in Firestore</h2>{loading&&<p role="status">Loading campaigns…</p>}{listError&&<p className="cloud-notice" role="alert">Could not load saved campaigns: {listError} Use Refresh campaigns to retry.</p>}{!loading&&!listError&&listLoaded&&!campaigns.length&&<p>No cloud campaigns found for this account. Browser-only campaigns can be imported below.</p>}
      {campaigns.map(c=><article key={c.id} className="cloud-save"><strong>{c.country}</strong><p>Round {c.round} · {c.territories}/10 countries · {c.finished?'Ended':'In progress'}{c.provenance==='local-import'?' · Legacy local import':''}</p><Link className="cloud-button" href={`/campaign/${c.id}`}>Open / resume</Link><button disabled={pending} onClick={()=>void navigator.clipboard.writeText(`${location.origin}/campaign/${c.id}`).then(()=>setMessage('Public watch link copied.')).catch(()=>setMessage(`Share this URL: ${location.origin}/campaign/${c.id}`))}>Copy public link</button><button disabled={pending} onClick={async()=>{
        if(!window.confirm(`Delete the cloud campaign for ${c.country} and its complete history?`))return;
        setPending(true);try{await cloudRequest(`/api/campaigns/${c.id}`,{method:'DELETE',user:auth.user,body:{revision:c.revision}});await refresh();}catch(e){setMessage(e instanceof Error?e.message:'Deletion failed. Refresh before retrying.');}finally{setPending(false);}
      }}>Delete cloud campaign</button></article>)}{next&&<button disabled={loading} onClick={()=>void refresh(next)}>Load more campaigns</button>}
      <h2>Explicitly import browser saves</h2><p>Nothing uploads automatically. Imported histories are replay-validated but labelled legacy: old browser dice cannot be authenticated retroactively. Your original browser saves are never deleted by this flow.</p><button disabled={pending} onClick={()=>{try{setLocal(new BrowserCampaignStore().all());setMessage('Browser saves inspected locally. Select a campaign below to upload it.');}catch{setMessage('Browser saves could not be read.');}}}>Inspect local saves (no upload)</button>
      {local.length>0&&<><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={pending}/>I choose to upload the selected campaign and make its game state and history publicly viewable by link.</label>{local.map(s=><article className="cloud-save" key={s.id}><strong>{s.countries[0].name}</strong><p>Round {s.round} · {s.events.length} recorded events</p><button disabled={!consent||pending} onClick={()=>void importLocal(s)}>Import this save to my account</button></article>)}</>}
    </>}{(message||auth.error)&&<p className="cloud-notice" role="status">{message||auth.error}</p>}</section></main>;
}
