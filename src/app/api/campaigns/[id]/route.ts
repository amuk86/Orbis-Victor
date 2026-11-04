import { authenticated } from '@/server/firebase-admin';
import { deleteCampaign,publicCampaign } from '@/server/campaigns';
import { body,respond } from '@/server/http';
import { exactKeys,integer } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
export async function GET(request:Request,context:Context){return respond(async()=>{
  const query=new URL(request.url).searchParams;
  const number=(key:string)=>query.has(key)?integer(Number(query.get(key)),key):undefined;
  return publicCampaign((await context.params).id,{after:number('after'),before:number('before'),known:number('known')});
});}
export async function DELETE(request:Request,context:Context){return respond(async()=>{
  const uid=await authenticated(request),b=await body(request);exactKeys(b,['revision']);
  return deleteCampaign((await context.params).id,uid,integer(b.revision,'revision'));
});}
