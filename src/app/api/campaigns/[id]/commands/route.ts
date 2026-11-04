import { authenticated } from '@/server/firebase-admin';
import { moveCampaign } from '@/server/campaigns';
import { body,respond } from '@/server/http';
import { commandFrom,exactKeys,integer,text } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return respond(async()=>{
  const uid=await authenticated(request),b=await body(request);exactKeys(b,['revision','command','requestId']);
  return moveCampaign((await context.params).id,uid,integer(b.revision,'revision'),commandFrom(b.command),text(b.requestId,'request ID',100));
});}
