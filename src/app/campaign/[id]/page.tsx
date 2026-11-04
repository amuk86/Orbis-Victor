import CloudCampaign from './CloudCampaign';
export default async function CampaignPage({params}:{params:Promise<{id:string}>}){return <CloudCampaign id={(await params).id}/>;}
