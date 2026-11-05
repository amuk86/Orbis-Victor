'use client';
import { useEffect,useState } from 'react';
import { onAuthStateChanged,signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { firebase,firebaseConfigured } from './firebase';
import { readCloudResponse } from './response';
export function useAuth(){
  const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(firebaseConfigured),[error,setError]=useState('');
  useEffect(()=>{
    if(!firebaseConfigured)return;
    try{return onAuthStateChanged(firebase().auth,u=>{setUser(u);setLoading(false);setError('');},()=>{setError('Authentication is unavailable. Please retry.');setLoading(false);});}
    catch(e){setError(e instanceof Error?e.message:'Authentication is unavailable.');setLoading(false);}
  },[]);
  return {user,loading,error,configured:firebaseConfigured,signOut:()=>signOut(firebase().auth)};
}
export async function cloudRequest<T>(path:string,options:{method?:string;body?:unknown;user?:User|null}={}):Promise<T>{
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(options.user)headers.Authorization=`Bearer ${await options.user.getIdToken()}`;
  let response:Response;
  try{response=await fetch(path,{method:options.method??'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body),cache:'no-store',signal:AbortSignal.timeout(options.method==='PUT'?65_000:30_000)});}
  catch{throw new Error('Network connection lost. The move is not confirmed. Reconnect and refresh before trying again.');}
  return readCloudResponse<T>(response);
}
