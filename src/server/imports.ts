import { admin } from './firebase-admin';
import { digest,persistNew } from './campaigns';
import { ApiError } from './protocol';
import { validateImport } from './import-validation';

type Manifest={uid:string;localId:string;digest:string;bytes:number;chunks:number;status:'pending'|'complete';campaignId:string};
export const IMPORT_CHUNK_BYTES=48_000,IMPORT_MAX_BYTES=6_000_000;
const refFor=(uid:string,id:string)=>admin().db.collection('users').doc(uid).collection('imports').doc(id);
export async function beginImport(uid:string,localId:string,hash:string,bytes:number,chunks:number) {
  if(!/^[a-f0-9]{64}$/.test(hash)||bytes<1||bytes>IMPORT_MAX_BYTES||chunks!==Math.ceil(bytes/IMPORT_CHUNK_BYTES))throw new ApiError(400,'Invalid import size or fingerprint.');
  const id=digest(`${uid}:${localId}`),ref=refFor(uid,id);
  const manifest=await admin().db.runTransaction(async tx=>{
    const doc=await tx.get(ref);
    if(doc.exists) {
      const old=doc.data() as Manifest;
      if(old.status==='complete')return old;
      if(old.digest!==hash)throw new ApiError(409,'This local campaign has another pending import. Keep the original save; finish importing its earlier version first.');
      return old;
    }
    const value:Manifest={uid,localId,digest:hash,bytes,chunks,status:'pending',campaignId:digest(`legacy:${uid}:${localId}`).slice(0,48)};
    tx.create(ref,value);return value;
  });
  return {id,status:manifest.status,campaignId:manifest.campaignId};
}
export async function uploadImportChunk(uid:string,id:string,index:number,data:string) {
  if(!/^[a-f0-9]{64}$/.test(id)||!Number.isSafeInteger(index)||index<0||data.length>64_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new ApiError(400,'Invalid import chunk.');
  const buffer=Buffer.from(data,'base64');
  if(buffer.toString('base64')!==data || buffer.length>IMPORT_CHUNK_BYTES)throw new ApiError(400,'Invalid encoded chunk.');
  const ref=refFor(uid,id),part=ref.collection('chunks').doc(String(index));
  await admin().db.runTransaction(async tx=>{
    const [doc,existing]=await tx.getAll(ref,part);
    if(!doc.exists)throw new ApiError(404,'Import session not found.');
    const m=doc.data() as Manifest;
    if(m.uid!==uid||m.status!=='pending'||index>=m.chunks)throw new ApiError(409,'Import session is not writable.');
    const expected=index===m.chunks-1?m.bytes-index*IMPORT_CHUNK_BYTES:IMPORT_CHUNK_BYTES;
    if(buffer.length!==expected)throw new ApiError(400,'Import chunk has the wrong size.');
    if(existing.exists && existing.data()!.hash!==digest(buffer))throw new ApiError(409,'Chunk contents changed.');
    tx.set(part,{data,hash:digest(buffer)});
  });
  return {uploaded:index};
}
export async function finishImport(uid:string,id:string) {
  if(!/^[a-f0-9]{64}$/.test(id))throw new ApiError(400,'Invalid import identifier.');
  const ref=refFor(uid,id),db=admin().db;
  const result=await db.runTransaction(async tx=>{
    const doc=await tx.get(ref);
    if(!doc.exists)throw new ApiError(404,'Import session not found.');
    const m=doc.data() as Manifest;
    if(m.uid!==uid)throw new ApiError(403,'Only the importing owner can finish this import.');
    const campaignRef=db.collection('campaigns').doc(m.campaignId);
    const existing=await tx.get(campaignRef);
    if(m.status==='complete') {
      if(!existing.exists || existing.data()?.status!=='ready')throw new ApiError(410,'This save was already imported and its cloud campaign was deleted.');
      return {id:m.campaignId,alreadyImported:true};
    }
    const chunks=await tx.getAll(...Array.from({length:m.chunks},(_,i)=>ref.collection('chunks').doc(String(i))));
    if(chunks.some(c=>!c.exists))throw new ApiError(409,'Some import chunks are missing. Retry the import.');
    const bytes=Buffer.concat(chunks.map(c=>Buffer.from(c.data()!.data,'base64')));
    if(bytes.length!==m.bytes || digest(bytes)!==m.digest)throw new ApiError(422,'Import fingerprint mismatch. The local save is retained.');
    let raw:unknown;try{raw=JSON.parse(bytes.toString('utf8'));}catch{throw new ApiError(422,'Invalid local JSON.');}
    const validated=validateImport(raw);
    if(validated.id!==m.localId)throw new ApiError(422,'The local campaign identifier changed.');
    if(existing.exists)throw new ApiError(409,'The imported campaign already exists.');
    persistNew(tx,m.campaignId,uid,{...validated,id:m.campaignId},'local-import');
    tx.update(ref,{status:'complete'});

    return {id:m.campaignId,alreadyImported:false};
  });
  // Cleanup is outside the transaction: large staged deletes plus history writes
  // could exceed Firestore's transaction request-size limit. A retry cleans up too.
  await db.recursiveDelete(ref.collection('chunks')).catch(()=>{});
  return {...result,url:`/campaign/${result.id}`};
}
