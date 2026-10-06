import { createHash, timingSafeEqual } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest();
export function createHandler({ store, apiKey }) {
    if (!apiKey || apiKey.length < 32 || apiKey.length > 512) throw new Error('STORE_API_KEY must contain 32–512 characters.');
    return async request => {
        const reply = (status, body) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json', 'Cache-Control':'no-store'}});
        const path = new URL(request.url).pathname;
        if (path === '/health' && request.method === 'GET') return reply(200, {ok:true});
        if (!timingSafeEqual(hash(request.headers.get('x-api-key') || ''), hash(apiKey))) return reply(401, {message:'Geçerli servis anahtarı gerekli.'});
        if (path !== '/save-bot' && path !== '/bot') return reply(404, {message:'Adres bulunamadı.'});
        if ((path === '/save-bot' && request.method !== 'POST') || (path === '/bot' && request.method !== 'GET')) return reply(405,{message:'İstek yöntemi geçersiz.'});
        try {
            if (path === '/bot') return reply(200, {accounts:await store.list()});
            if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply(415,{message:'JSON gerekli.'});
            if (Number(request.headers.get('content-length')) > 65536) return reply(413,{message:'İstek çok büyük.'});
            const reader = request.body?.getReader();
            let size=0, chunks=[];
            if (reader) {
                try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length;
                    if(size>65536) { await reader.cancel(); return reply(413,{message:'İstek çok büyük.'}); }
                    chunks.push(Buffer.from(value));
                }} finally { reader.releaseLock(); }
            }
            let input;
            try { input=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400,{message:'JSON geçersiz.'}); }
            const servers=new Set('TR US CA GB NL IE DK FR PL SE NO FI ES DE AU NZ'.split(' '));
            if (!input || typeof input.profileId!=='string' || !input.profileId || input.profileId.length>200 || /[\s\x00-\x1f]/.test(input.profileId)
                || typeof input.accessToken!=='string' || !input.accessToken || input.accessToken.length>32768 || /[\x00-\x1f]/.test(input.accessToken)
                || typeof input.username!=='string' || !input.username || input.username.length>120
                || !servers.has(input.server) || !(input.expiresIn===null || (typeof input.expiresIn==='number' && Number.isFinite(input.expiresIn) && input.expiresIn>=0 && input.expiresIn<=31536000)))
                return reply(400,{message:'Oturum alanları geçersiz.'});
            const saved = await store.save({profileId:input.profileId,accessToken:input.accessToken,username:input.username,server:input.server,expiresIn:input.expiresIn});
            return reply(200,{saved:true,profileId:input.profileId,total:saved.total});
        } catch { return reply(503,{message:'Veritabanı işlemi tamamlanamadı.'}); }
    };
}
