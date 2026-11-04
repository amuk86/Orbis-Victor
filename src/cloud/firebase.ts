'use client';
import { getApps,initializeApp } from 'firebase/app';
import { connectAuthEmulator,getAuth } from 'firebase/auth';
import { connectFirestoreEmulator,getFirestore } from 'firebase/firestore';
export const firebaseConfigured=!!(process.env.NEXT_PUBLIC_FIREBASE_API_KEY&&process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID&&process.env.NEXT_PUBLIC_FIREBASE_APP_ID);
let cached:ReturnType<typeof initialise>|undefined;
function initialise(){
  if(!firebaseConfigured)throw new Error('Firebase is not configured. See docs/FIREBASE.md or use the local demo.');
  const app=getApps().find(a=>a.name==='orbis-victor-client')??initializeApp({
    apiKey:process.env.NEXT_PUBLIC_FIREBASE_API_KEY,authDomain:process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,appId:process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  },'orbis-victor-client');
  const auth=getAuth(app),db=getFirestore(app);
  if(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS==='true'){
    if(!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.startsWith('demo-') || !['localhost','127.0.0.1'].includes(window.location.hostname))throw new Error('Emulators require localhost and a demo- project.');
    // SDK instances survive Next.js HMR. Only connect their emulators once.
    const marker=app as typeof app & {orbisEmulators?:boolean};
    if(!marker.orbisEmulators){
      const authHost=process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST??'127.0.0.1:9099';
      const fsHost=process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST??'127.0.0.1:8080';
      connectAuthEmulator(auth,`http://${authHost}`,{disableWarnings:true});
      const url=new URL(`http://${fsHost}`);connectFirestoreEmulator(db,url.hostname,Number(url.port));
      marker.orbisEmulators=true;
    }
  }
  return {auth,db};
}
export function firebase(){return cached??(cached=initialise());}
