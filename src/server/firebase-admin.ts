import 'server-only';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiError } from './protocol';

/** Only imported by Node route handlers/server modules. Never import from a client component. */
export function admin() {
  if(typeof window!=='undefined')throw new Error('Admin SDK is server-only.');
  const projectId=process.env.FIREBASE_PROJECT_ID;
  if(!projectId)throw new ApiError(503,'Firebase server configuration is missing. The local demo is still available.');
  const emulator=process.env.FIREBASE_USE_EMULATORS==='true';
  const hasEmulator=!!(process.env.FIREBASE_AUTH_EMULATOR_HOST||process.env.FIRESTORE_EMULATOR_HOST);
  if(process.env.VERCEL && (emulator||hasEmulator))throw new ApiError(503,'Emulators cannot be enabled on Vercel.');
  if(emulator!==hasEmulator || (emulator&&(!projectId.startsWith('demo-')||!process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.FIRESTORE_EMULATOR_HOST)))throw new ApiError(503,'Use both emulators with a demo- project, or disable emulator variables completely.');
  let app=getApps().find(a=>a.name==='orbis-victor-server');
  if(!app) {
    const email=process.env.FIREBASE_CLIENT_EMAIL,key=process.env.FIREBASE_PRIVATE_KEY;
    if(!emulator && !!email!==!!key)throw new ApiError(503,'Firebase server credentials are incomplete.');
    app=initializeApp({projectId,...(emulator?{}:{credential:email&&key?cert({projectId,clientEmail:email,privateKey:key.replace(/\\n/g,'\n')}):applicationDefault()})},'orbis-victor-server');
  }
  return {db:getFirestore(app),auth:getAuth(app)};
}
export async function authenticated(request:Request):Promise<string> {
  const header=request.headers.get('authorization');
  if(!header?.startsWith('Bearer ') || header.length>10000)throw new ApiError(401,'Sign in to manage your campaigns.');
  const {auth}=admin();
  try { return (await auth.verifyIdToken(header.slice(7),true)).uid; }
  catch { throw new ApiError(401,'Your session expired or is invalid. Please sign in again.'); }
}
