import { authenticated } from '@/server/firebase-admin';
import { uploadImportChunk,finishImport } from '@/server/imports';
import { body,respond } from '@/server/http';
import { exactKeys,integer,text } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return respond(async()=>{
  const uid=await authenticated(request),b=await body(request);exactKeys(b,['index','data']);
  return uploadImportChunk(uid,(await context.params).id,integer(b.index,'chunk index',124),text(b.data,'chunk data',64_000));
});}
export async function PUT(request:Request,context:{params:Promise<{id:string}>}){return respond(async()=>finishImport(await authenticated(request),(await context.params).id));}
