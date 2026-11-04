import { ApiError, object } from './protocol';
export async function body(request:Request,max=90_000) {
  if(!request.headers.get('content-type')?.includes('application/json'))throw new ApiError(415,'Send application/json.');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'Missing request body.');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new ApiError(413,'Request too large.');}parts.push(value);}
  try{return object(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'Invalid JSON.');}
}
export async function respond(work:()=>Promise<unknown>) {
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try{return Response.json(await work(),{headers});}
  catch(error){
    const missingIndex=typeof error==='object'&&error!==null&&'code' in error&&error.code===9&&'message' in error&&/index/i.test(String(error.message));
    const status=error instanceof ApiError?error.status:503;
    const message=error instanceof ApiError?error.message:missingIndex?'A required Firestore index is missing or still building. Your saved campaigns have not been deleted. See docs/FIREBASE.md and firestore.indexes.json.':'Cloud persistence is temporarily unavailable. Retry without closing your local save.';
    return Response.json({error:message},{status,headers});
  }
}
