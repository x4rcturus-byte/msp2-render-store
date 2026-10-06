import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../handler.js';
import { createStore } from '../store.js';
const key='test-key-012345678901234567890123456789';
const input={profileId:'profile-own',accessToken:'test-token',username:'own',server:'TR',expiresIn:3600};
const request=(path='/save-bot',body=input,auth=key,method='POST')=>new Request('https://own.onrender.com'+path,{method,headers:{'Content-Type':'application/json','X-API-Key':auth},...(method==='POST'?{body:JSON.stringify(body)}:{})});
test('anonymous dashboard escapes names and never fetches or renders tokens',async()=>{
    let publicCalls=0;const handler=createHandler({apiKey:key,store:{
        listPublic:async()=>{publicCalls++;return [{username:'<script>alert(1)</script>',server:'TR',profileId:'own',expired:false,accessToken:'MUST-NOT-APPEAR',expiresAt:new Date(Date.now()+60000),savedAt:new Date()}];},
        list:async()=>{throw Error('Private token read must not happen');}
    }});
    const response=await handler(new Request('https://own.onrender.com/bot'));
    assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/html/);
    const html=await response.text();assert.ok(!html.includes('MUST-NOT-APPEAR'));assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Süresi dolmamış'));assert.equal(publicCalls,1);
    assert.equal((await handler(request('/bot',null,'wrong','GET'))).status,401);
    assert.equal((await handler(new Request('https://own.onrender.com/save-bot',{method:'POST',body:'{}'}))).status,401);
});
test('public database query excludes encrypted tokens and returns only metadata',async()=>{
    const store=createStore({query:async sql=>{
        assert.ok(!sql.includes('token_cipher'));assert.ok(!sql.includes('SELECT *'));
        return {rows:[{profile_id:'p',username:'own',server:'TR',expires_at:new Date(Date.now()-1000),saved_at:new Date(),token_cipher:'invalid ciphertext'}]};
    }},'ab'.repeat(32));
    const rows=await store.listPublic();assert.equal(rows[0].expired,true);assert.equal('accessToken' in rows[0],false);assert.equal('token_cipher' in rows[0],false);
});
test('health public; writes and reads require key and unsupported methods fail',async()=>{
    let calls=0;const handler=createHandler({apiKey:key,store:{save:async()=>{calls++;},list:async()=>{calls++;}}});
    assert.equal((await handler(request('/health',null,'','GET'))).status,200);
    assert.equal((await handler(request('/save-bot',input,'wrong'))).status,401);
    assert.equal((await handler(request('/bot',null,'wrong','GET'))).status,401);
    assert.equal((await handler(request('/save-bot',null,key,'GET'))).status,405);assert.equal(calls,0);
});
test('save strips extra fields and read returns authorized session list',async()=>{
    let saved;const handler=createHandler({apiKey:key,store:{save:async value=>{saved=value;return {total:1};},list:async()=>[input]}});
    const response=await handler(request('/save-bot',{...input,password:'must-not-store'}));
    assert.equal(response.status,200);assert.deepEqual(saved,input);assert.equal('password' in saved,false);
    assert.deepEqual((await (await handler(request('/bot',null,key,'GET'))).json()).accounts,[input]);
    assert.equal(response.headers.get('cache-control'),'no-store');
});
test('invalid, oversized input and database failures produce sanitized errors',async()=>{
    const handler=createHandler({apiKey:key,store:{save:async()=>{throw Error('SECRET DATABASE ERROR');}}});
    assert.equal((await handler(request('/save-bot',{...input,expiresIn:'bad'}))).status,400);
    assert.equal((await handler(request('/save-bot',{...input,accessToken:'x'.repeat(70000)}))).status,413);
    const response=await handler(request());assert.equal(response.status,503);assert.ok(!(await response.text()).includes('SECRET'));
});
test('database stores authenticated ciphertext, parameterized upsert and decrypts after reload',async()=>{
    let record;const pool={query:async(sql,values)=>{
        if(sql.startsWith('INSERT')){assert.match(sql,/ON CONFLICT/);assert.ok(!sql.includes(input.accessToken));record={profile_id:values[0],username:values[1],server:values[2],token_cipher:values[3],expires_at:values[4],saved_at:new Date()};return {rows:[]};}
        if(sql.startsWith('SELECT COUNT'))return {rows:[{total:1}]};
        if(sql.startsWith('SELECT *'))return {rows:[record]};
        return {rows:[]};
    }};
    const store=createStore(pool,'ab'.repeat(32));await store.init();await store.save(input);
    assert.ok(!record.token_cipher.includes(input.accessToken));
    const reloaded=createStore(pool,'ab'.repeat(32));assert.equal((await reloaded.list())[0].accessToken,input.accessToken);
    record.profile_id='tampered';await assert.rejects(reloaded.list());
});
