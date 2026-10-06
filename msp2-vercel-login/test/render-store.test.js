import test from 'node:test';
import assert from 'node:assert/strict';
import { renderConfig, saveToRender } from '../lib/render-store.js';
import { runAccounts } from '../public/batch.js';
import { createLoginHandler } from '../lib/login.js';
const key='test-store-key-012345678901234567890123';
const config=renderConfig({RENDER_STORE_URL:'https://own.onrender.com',RENDER_STORE_KEY:key});
const result={profileId:'own-profile',accessToken:'test-token',expiresIn:3600};
test('full login handler saves successful game token and does not expose Render key',async()=>{
    const loginKey='test-login-key-012345678901234567890123';let calls=0;
    const token=`test.${Buffer.from(JSON.stringify({profileId:'own-profile',gameId:'j68d'})).toString('base64url')}.test`;
    const handler=createLoginHandler({env:{LOGIN_API_KEY:loginKey,MSP_CLIENT_SECRET:'test-secret',RENDER_STORE_URL:'https://own.onrender.com',RENDER_STORE_KEY:key},fetchImpl:async(url,options)=>{
        if(++calls===1)return new Response(JSON.stringify({access_token:token,expires_in:3600}));
        assert.equal(url,config.url);assert.equal(JSON.parse(options.body).accessToken,token);
        return new Response(JSON.stringify({saved:true,profileId:'own-profile'}));
    }});
    const response=await handler(new Request('https://own.vercel.app/login',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':loginKey},body:JSON.stringify({username:'own',password:'dummy',server:'TR'})}));
    const text=await response.text();assert.equal(response.status,200);assert.equal(JSON.parse(text).saved,true);assert.ok(!text.includes(key));assert.equal(calls,2);
});
test('incomplete Render configuration fails before MSP login',async()=>{
    const loginKey='test-login-key-012345678901234567890123';let calls=0;
    const handler=createLoginHandler({env:{LOGIN_API_KEY:loginKey,MSP_CLIENT_SECRET:'test-secret',RENDER_STORE_URL:'https://own.onrender.com'},fetchImpl:async()=>{calls++;}});
    const response=await handler(new Request('https://own.vercel.app/login',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':loginKey},body:'{}'}));
    assert.equal(response.status,503);assert.equal(calls,0);
});
test('optional configuration validates private HTTPS destination and key',()=>{
    assert.equal(renderConfig({}),null);
    for(const url of ['http://own.onrender.com','https://third-party.test','https://own.onrender.com/redirect','https://user:pass@own.onrender.com'])assert.throws(()=>renderConfig({RENDER_STORE_URL:url,RENDER_STORE_KEY:key}));
    assert.throws(()=>renderConfig({RENDER_STORE_URL:'https://own.onrender.com'}));
});
test('Vercel sends only session metadata to Render, blocks redirects and checks acknowledgement',async()=>{
    const saved=await saveToRender(result,{username:'TR|own',password:'not-for-render'},config,async(url,options)=>{
        assert.equal(url,'https://own.onrender.com/save-bot');assert.equal(options.headers['X-API-Key'],key);assert.equal(options.redirect,'error');
        assert.deepEqual(JSON.parse(options.body),{...result,username:'own',server:'TR'});
        return new Response(JSON.stringify({saved:true,profileId:'own-profile',total:1}));
    });assert.equal(saved.saved,true);
});
test('Render failure preserves login token but prevents subsequent batches',async()=>{
    let calls=0;
    const saved=await saveToRender(result,{username:'own',server:'TR'},config,async()=>new Response('Unavailable',{status:503}));
    assert.equal(saved.saved,false);assert.equal(saved.accessToken,result.accessToken);
    const accounts=[{username:'own',server:'TR',password:'pw'},{username:'second',server:'TR',password:'pw'}];
    const outcome=await runAccounts(accounts,{concurrency:1,login:async()=>{calls++;return saved;}});
    assert.equal(calls,1);assert.equal(outcome.reason,'error');assert.equal(outcome.results[0].ok,true);
    assert.ok(accounts.every(row=>row.password===''));
});
