export function renderConfig(env) {
    if (!env.RENDER_STORE_URL && !env.RENDER_STORE_KEY) return null;
    const url=new URL(env.RENDER_STORE_URL);
    if (url.protocol!=='https:' || !url.hostname.endsWith('.onrender.com') || url.username || url.password || url.search || url.hash
        || !['/','/save-bot'].includes(url.pathname) || !env.RENDER_STORE_KEY || env.RENDER_STORE_KEY.length<32 || env.RENDER_STORE_KEY.length>512)
        throw new Error('Invalid Render configuration.');
    url.pathname='/save-bot'; return {url:url.href,key:env.RENDER_STORE_KEY};
}
export async function saveToRender(result, input, config, fetchImpl) {
    if (!config) return result;
    const prefixed=String(input.username).trim().split('|');
    const username=prefixed.length===2 ? prefixed[1].trim() : prefixed[0];
    const server=(prefixed.length===2 ? prefixed[0] : input.server || 'TR').trim().toUpperCase();
    try {
        const response=await fetchImpl(config.url,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':config.key},
            body:JSON.stringify({...result,username,server}),redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok) throw new Error('Save failed.');
        const body=await response.json();
        if(body.saved!==true || body.profileId!==result.profileId) throw new Error('Invalid save response.');
        return {...result,saved:true};
    } catch {return {...result,saved:false,saveError:'Giriş başarılı, ancak Render kaydı başarısız. Oturum sonucu korunuyor; yeni gruplar durduruldu.'};}
}
