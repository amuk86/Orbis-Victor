import { authenticated } from '@/server/firebase-admin';
import { createCampaign,listCampaigns } from '@/server/campaigns';
import { body,respond } from '@/server/http';
import { exactKeys,text } from '@/server/protocol';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return respond(async()=>listCampaigns(await authenticated(request),new URL(request.url).searchParams.get('after')??undefined));}
export async function POST(request:Request){return respond(async()=>{
  const uid=await authenticated(request),b=await body(request);exactKeys(b,['country','requestId']);
  return createCampaign(uid,text(b.country,'country',2),text(b.requestId,'request ID',100));
});}
