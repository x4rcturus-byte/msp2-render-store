import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccounts, runAccounts } from '../public/batch.js';
test('TXT formats, BOM, comments, colons and password whitespace', () => {
    assert.deepEqual(parseAccounts('\uFEFF# comment\r\nTR|alice: a:b:TR \r\nbob:pass:GB\r\ncarol:pw\n'), [
        { username: 'alice', password: ' a:b:TR ', server: 'TR' },
        { username: 'bob', password: 'pass', server: 'GB' },
        { username: 'carol', password: 'pw', server: 'TR' }
    ]);
});
test('duplicates deduplicate; conflicting passwords are rejected', () => {
    assert.equal(parseAccounts('TR|alice:pw\ntr|ALICE:pw').length, 1);
    assert.throws(() => parseAccounts('alice:pw\nalice:different'), /farklı şifreler/);
});
test('invalid input errors omit secret content and enforce size and count limits', () => {
    for (const text of ['', 'ZZ|alice:secret', 'alice:', 'no-colon', 'x'.repeat(1048577), Array.from({length:501}, (_, i) => `a${i}:pw`).join('\n')]) {
        assert.throws(() => parseAccounts(text), error => !error.message.includes('secret'));
    }
});
test('single-account groups wait 15 seconds between groups; results contain no passwords', async () => {
    const accounts = parseAccounts('alice:pw\nbob:pw');
    let active = 0, maximum = 0, waits = 0;
    const outcome = await runAccounts(accounts, { concurrency:1, login: async () => {
        active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;
        return { profileId:'p', accessToken:'t' };
    }, wait: async ms => { assert.equal(ms, 15000); waits++; } });
    assert.equal(maximum, 1); assert.equal(waits, 1); assert.equal(outcome.results.length, 2);
    assert.ok(outcome.results.every(row => !('password' in row)));
    assert.ok(accounts.every(row => row.password === ''));
});
test('credential rejection continues to next account', async () => {
    let calls = 0;
    const outcome = await runAccounts(parseAccounts('alice:pw\nbob:pw'), { concurrency:1, login: async () => {
        if (++calls === 1) throw Object.assign(new Error('Rejected'), {status:401, code:'MSP_LOGIN_REJECTED'});
        return {profileId:'p', accessToken:'t'};
    }, wait:async()=>{} });
    assert.equal(outcome.reason, 'complete'); assert.equal(calls, 2); assert.equal(outcome.results[0].ok, false);
});
test('WAF, rate limit, API key and transport failures stop without retrying', async () => {
    for (const failure of [{status:403}, {status:429}, {status:401, code:'API_KEY_REQUIRED'}, {status:503}, {}]) {
        let calls = 0; const accounts = parseAccounts('alice:pw\nbob:pw');
        const outcome = await runAccounts(accounts, { concurrency:1, login:async()=>{ calls++; throw Object.assign(new Error('Failure'), failure); }, wait:async()=>{} });
        assert.equal(outcome.reason, 'error'); assert.equal(calls, 1); assert.ok(accounts.every(row => row.password === ''));
    }
});
test('stop during active request completes it and prevents the next account', async () => {
    const controller = new AbortController(); let calls=0;
    const outcome = await runAccounts(parseAccounts('alice:pw\nbob:pw'), {concurrency:1,signal:controller.signal, login:async()=>{calls++;controller.abort();return {profileId:'p',accessToken:'t'};}});
    assert.equal(calls, 1); assert.equal(outcome.reason, 'stopped'); assert.equal(outcome.results.length, 1);
});
test('stop during delay prevents next request and clears all passwords', async () => {
    const controller = new AbortController(); const accounts = parseAccounts('alice:pw\nbob:pw'); let calls=0;
    const outcome = await runAccounts(accounts, {concurrency:1,signal:controller.signal, login:async()=>{calls++; return {profileId:'p',accessToken:'t'};}, wait:async()=>controller.abort()});
    assert.equal(calls, 1); assert.equal(outcome.reason, 'stopped'); assert.ok(accounts.every(row => row.password === ''));
});
test('default starts exactly 50 accounts together; next batch waits for every request plus 15 seconds', async () => {
    const accounts = parseAccounts(Array.from({length:51}, (_, i)=>`a${i}:pw`).join('\n'));
    const pending=[]; let calls=0, waits=0;
    const done=runAccounts(accounts,{login:account=>{calls++;return new Promise(resolve=>pending.push(()=>resolve({profileId:account.username,accessToken:'t'})));},wait:async ms=>{assert.equal(ms,15000);waits++;}});
    assert.equal(calls,50);
    for(let i=0;i<49;i++)pending[i]();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,50); assert.equal(waits,0);
    pending[49](); await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls,51); assert.equal(waits,1);
    pending[50]();const outcome=await done;
    assert.equal(outcome.results.length,51);assert.equal(waits,1);assert.equal(outcome.reason,'complete');
    assert.ok(accounts.every(row=>row.password===''));
});
test('rate limit drains active batch, preserves failure message and never starts next batch', async () => {
    let calls=0, waits=0;const accounts=parseAccounts('alice:pw\nbob:pw\ncarol:pw');
    const outcome=await runAccounts(accounts,{concurrency:2,login:async account=>{
        calls++;
        if(account.username==='alice')throw Object.assign(new Error('Limit reached'),{status:429});
        await new Promise(resolve=>setImmediate(resolve));return {profileId:'p',accessToken:'t'};
    },wait:async()=>{waits++;}});
    assert.equal(calls,2);assert.equal(waits,0);assert.equal(outcome.results.length,2);
    assert.equal(outcome.reason,'error');assert.equal(outcome.failureMessage,'Limit reached');
    assert.equal(outcome.results.at(-1).ok,true);assert.ok(accounts.every(row=>row.password===''));
});
test('stop drains active parallel batch; countdown wait aborts immediately', async () => {
    const controller=new AbortController();let calls=0;
    const outcome=await runAccounts(parseAccounts('alice:pw\nbob:pw\ncarol:pw'),{concurrency:2,signal:controller.signal,login:async()=>{
        calls++;await Promise.resolve();controller.abort();return {profileId:'p',accessToken:'t'};
    }});
    assert.equal(calls,2);assert.equal(outcome.results.length,2);assert.equal(outcome.reason,'stopped');
    const second=new AbortController();
    const waiting=await runAccounts(parseAccounts('alice:pw\nbob:pw'),{concurrency:1,signal:second.signal,login:async()=>({profileId:'p',accessToken:'t'}),onWait:()=>setTimeout(()=>second.abort(),5)});
    assert.equal(waiting.reason,'stopped');assert.equal(waiting.results.length,1);
});
test('invalid concurrency is rejected and clears passwords', async () => {
    const accounts=parseAccounts('alice:pw');
    await assert.rejects(runAccounts(accounts,{concurrency:51,login:async()=>{throw Error('Must not run');}}),/1–50/);
    assert.equal(accounts[0].password,'');
});
