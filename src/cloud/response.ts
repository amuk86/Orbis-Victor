/** Keep platform error pages and empty responses out of the JSON-only API path. */
export async function readCloudResponse<T>(response:Response):Promise<T>{
  let data:unknown;
  try{data=await response.json();}
  catch{
    const message=response.status===504
      ?'The cloud request timed out (HTTP 504). Refresh before trying again; a save may still have completed.'
      :`The cloud API returned an empty or invalid response (HTTP ${response.status}). Check the deployment's /api/campaigns logs and refresh before trying again.`;
    throw Object.assign(new Error(message),{status:response.status});
  }
  if(!response.ok){
    const message=typeof data==='object'&&data!==null&&'error' in data&&typeof data.error==='string'
      ?data.error:`Cloud request failed (HTTP ${response.status}). Refresh before trying again.`;
    throw Object.assign(new Error(message),{status:response.status});
  }
  if(data===null||typeof data!=='object'){
    throw Object.assign(new Error(`The cloud API returned invalid data (HTTP ${response.status}). Refresh before trying again.`),{status:response.status});
  }
  return data as T;
}
