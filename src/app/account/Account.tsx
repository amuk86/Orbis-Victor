'use client';
import {useState} from 'react';
import type {FormEvent} from 'react';
import Link from 'next/link';
import {createUserWithEmailAndPassword,GoogleAuthProvider,sendPasswordResetEmail,signInWithEmailAndPassword,signInWithPopup} from 'firebase/auth';
import {firebase} from '@/cloud/firebase';
import {useAuth} from '@/cloud/auth';
import '../play/cloud.css';
export default function Account(){
  const auth=useAuth(),[mode,setMode]=useState<'signin'|'signup'|'reset'>('signin');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  async function run(work:()=>Promise<unknown>){setPending(true);setMessage('');try{await work();}catch(error){
    const code=typeof error==='object'&&error&&'code' in error?String(error.code):'';
    const messages:Record<string,string>={
      'auth/invalid-credential':'The email or password is incorrect. Please retry or reset your password.',
      'auth/email-already-in-use':'An account already uses this email. Sign in or reset your password.',
      'auth/weak-password':'Choose a stronger password that meets the Firebase project’s password policy.',
      'auth/popup-blocked':'Your browser blocked the Google sign-in popup. Allow popups and try again.',
      'auth/popup-closed-by-user':'Google sign-in was cancelled. You can try again.',
      'auth/unauthorized-domain':'This domain is not authorized for Firebase sign-in. Add it in Firebase Authentication settings.',
      'auth/operation-not-allowed':'This sign-in provider is not enabled in the Firebase project.',
      'auth/network-request-failed':'Authentication could not connect. Check your network and try again.',
      'auth/too-many-requests':'Too many authentication attempts. Wait before trying again.',
    };
    setMessage(messages[code]??'Unable to complete authentication. Check your details and Firebase configuration.');
  }finally{setPending(false);}}
  function submit(e:FormEvent){e.preventDefault();void run(async()=>{
    const a=firebase().auth;
    if(mode==='reset'){await sendPasswordResetEmail(a,email);setMessage('If this address has an account, a password reset email has been sent. In emulator mode, use the reset link in the emulator terminal.');}
    else if(mode==='signup')await createUserWithEmailAndPassword(a,email,password);
    else await signInWithEmailAndPassword(a,email,password);
  });}
  return <main className="cloud-page"><section className="cloud-panel"><Link href="/play">← Campaigns</Link><h1>Field credentials</h1>
    {!auth.configured?<p>Firebase is not configured. Follow <code>docs/FIREBASE.md</code> or <Link href="/game/demo">play the local demo</Link>.</p>:auth.loading?<p role="status">Checking your session…</p>:auth.user?<><p>Signed in as {auth.user.email??auth.user.displayName??'commander'}.</p><Link className="cloud-button" href="/play">My campaigns</Link><button disabled={pending} onClick={()=>void run(auth.signOut)}>Sign out</button></>:<>
      <div className="cloud-actions">{(['signin','signup','reset'] as const).map(m=><button key={m} aria-pressed={mode===m} disabled={pending} onClick={()=>{setMode(m);setMessage('');}}>{m==='signin'?'Sign in':m==='signup'?'Create account':'Reset password'}</button>)}</div>
      <form onSubmit={submit}><label>Email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} disabled={pending}/></label>{mode!=='reset'&&<label>Password<input required type="password" minLength={6} autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} disabled={pending}/></label>}<button disabled={pending} type="submit">{pending?'Please wait…':mode==='signin'?'Sign in':mode==='signup'?'Create account':'Send reset email'}</button></form>
      <button disabled={pending} onClick={()=>void run(()=>signInWithPopup(firebase().auth,new GoogleAuthProvider()))}>Continue with Google</button>
    </>}{(message||auth.error)&&<p role="status" className="cloud-notice">{message||auth.error}</p>}</section></main>;
}
