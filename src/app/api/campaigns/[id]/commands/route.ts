import { authenticated } from '@/server/firebase-admin';
import { moveCampaign } from '@/server/campaigns';
import { body,respond } from '@/server/http';
import { commandFrom,exactKeys,integer,text } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const start=performance.now();let authMs=0,transactionMs=0;
  const response=await respond(async()=>{
    const uid=await authenticated(request);authMs=performance.now()-start;
    const b=await body(request);exactKeys(b,['revision','command','requestId']);
    const result=await moveCampaign((await context.params).id,uid,integer(b.revision,'revision'),commandFrom(b.command),text(b.requestId,'request ID',100));
    transactionMs=result.timings.transactionMs;
    return {...result,timings:{...result.timings,authMs,serverMs:performance.now()-start}};
  });
  response.headers.set('Server-Timing',`auth;dur=${authMs.toFixed(1)},transaction;dur=${transactionMs.toFixed(1)},server;dur=${(performance.now()-start).toFixed(1)}`);
  return response;
}
