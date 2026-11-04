import { authenticated } from '@/server/firebase-admin';
import { beginImport } from '@/server/imports';
import { body,respond } from '@/server/http';
import { ApiError,exactKeys,integer,text } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){return respond(async()=>{
  const uid=await authenticated(request),b=await body(request);exactKeys(b,['localId','digest','bytes','chunks','consent']);
  if(b.consent!==true)throw new ApiError(400,'Explicit import consent is required.');
  return beginImport(uid,text(b.localId,'local ID'),text(b.digest,'digest',64),integer(b.bytes,'bytes'),integer(b.chunks,'chunks',125));
});}
