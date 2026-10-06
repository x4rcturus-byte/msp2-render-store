import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginHandler, TOKEN_URL } from '../lib/login.js';

const key = 'test-only-private-key-0123456789abcdef';
const env = { LOGIN_API_KEY: key, MSP_CLIENT_ID: 'unity.client', MSP_CLIENT_SECRET: 'test-client-secret' };
const jwt = body => `test.${Buffer.from(JSON.stringify(body)).toString('base64url')}.test`;
const gameToken = jwt({ profileId: 'profile-own', gameId: 'j68d', loginId: 'login-own' });
const tokenBody = { access_token: gameToken, expires_in: 3600 };
function request(body = { username: 'TR|own-account', password: 'own-password' }, headers = {}, method = 'POST') {
    return new Request('https://my-service.test/login', {
        method, headers: { 'content-type': 'application/json', 'x-api-key': key, ...headers },
        ...(!['GET', 'OPTIONS'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    });
}
function mock(responses) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const item = responses.shift();
        assert.ok(item, 'Unexpected additional upstream request');
        if (item.throw) throw item.throw;
        return new Response(item.raw ?? JSON.stringify(item.body), { status: item.status || 200, headers: { 'content-type': 'application/json', ...item.headers } });
    };
    return { calls, fetchImpl };
}

test('private key is required before any upstream request', async () => {
    const m = mock([]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request(undefined, { 'x-api-key': 'wrong' }));
    assert.equal(response.status, 401);
    assert.equal(m.calls.length, 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing configuration fails closed and GET is unsupported', async () => {
    const m = mock([]);
    assert.equal((await createLoginHandler({ env: {}, fetchImpl: m.fetchImpl })(request())).status, 503);
    assert.equal((await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request(undefined, {}, 'GET'))).status, 405);
    assert.equal(m.calls.length, 0);
});

test('CORS permits only the service and explicitly configured origins', async () => {
    const m = mock([]);
    const handler = createLoginHandler({ env: { ...env, ALLOWED_ORIGINS: 'https://my-panel.test' }, fetchImpl: m.fetchImpl });
    assert.equal((await handler(request(undefined, { origin: 'https://other.test' }))).status, 403);
    const response = await handler(request(undefined, { origin: 'https://my-panel.test' }, 'OPTIONS'));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://my-panel.test');
    assert.equal(m.calls.length, 0);
});

test('password grant uses only the supplied password and official fixed endpoint', async () => {
    const m = mock([{ body: tokenBody }]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request({ username: 'own-account', server: 'US', password: '  Keep+This&Exactly  ', wafToken: 'valid-existing-token' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { profileId: 'profile-own', accessToken: gameToken, expiresIn: 3600 });
    assert.equal(m.calls.length, 1);
    const call = m.calls[0];
    assert.equal(call.url, TOKEN_URL);
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.headers['x-aws-waf-token'], 'valid-existing-token');
    const data = new URLSearchParams(call.options.body);
    assert.equal(data.get('username'), 'US|own-account');
    assert.equal(data.get('password'), '  Keep+This&Exactly  ');
    assert.equal(data.get('grant_type'), 'password');
    assert.equal(data.get('client_secret'), env.MSP_CLIENT_SECRET);
    assert.match(data.get('acr_values'), /^gameId:j68d deviceId:[A-F0-9]{64}$/);
});

test('profile lookup and game-bound refresh follow the supplied project', async () => {
    const identity = jwt({ sub: 'login/own' });
    const m = mock([
        { body: { access_token: identity, refresh_token: 'refresh-own' } },
        { body: [{ id: 'profile-own' }] },
        { body: tokenBody }
    ]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request({ username: 'GB|own-account', password: 'password' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).accessToken, gameToken);
    assert.equal(m.calls.length, 3);
    assert.equal(m.calls[1].url, 'https://eu.mspapis.com/profileidentity/v1/logins/login%2Fown/profiles?pageSize=100&page=1&filter=region:GB');
    assert.equal(m.calls[1].options.headers.Authorization, `Bearer ${identity}`);
    const initial = new URLSearchParams(m.calls[0].options.body);
    const refresh = new URLSearchParams(m.calls[2].options.body);
    assert.equal(refresh.get('grant_type'), 'refresh_token');
    assert.equal(refresh.get('refresh_token'), 'refresh-own');
    assert.equal(refresh.get('acr_values'), `gameId:j68d profileId:profile-own ${initial.get('acr_values').split(' ')[1]}`);
});

test('successful refresh stages are bounded when MSP returns no game token', async () => {
    const identity = jwt({ profileId: 'profile-own' });
    const m = mock(Array.from({ length: 3 }, () => ({ body: { access_token: identity, refresh_token: 'refresh-own' } })));
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'MSP_GAME_TOKEN_MISSING');
    assert.equal(m.calls.length, 3);
});

test('429 forwards the wait time and never retries', async () => {
    const m = mock([{ status: 429, body: { secret: 'must-not-leak' }, headers: { 'retry-after': '120' } }]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '120');
    assert.equal(m.calls.length, 1);
    assert.ok(!(await response.text()).includes('must-not-leak'));
});

test('WAF denial stops without alternative endpoints, devices, or retries', async () => {
    const m = mock([{ status: 403, raw: '<html>challenge</html>' }]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'MSP_VERIFICATION_REQUIRED');
    assert.equal(m.calls.length, 1);
});

test('rejected credentials are sanitized and not retried', async () => {
    const m = mock([{ status: 400, body: { error: 'invalid_grant', error_description: 'password=must-not-leak' } }]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes('must-not-leak'));
    assert.equal(m.calls.length, 1);
});

test('invalid input, unsupported content types and oversized bodies never reach MSP', async () => {
    const m = mock([]);
    const handler = createLoginHandler({ env, fetchImpl: m.fetchImpl });
    assert.equal((await handler(request('{bad json'))).status, 400);
    assert.equal((await handler(request({ username: 'ZZ|own-account', password: 'pw' }))).status, 400);
    assert.equal((await handler(request({ username: 'TR|x|y', password: 'pw' }))).status, 400);
    assert.equal((await handler(request({ username: 'x', password: 'pw', wafToken: 'x\r\nInjected' }))).status, 400);
    assert.equal((await handler(request(undefined, { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await handler(request({ username: 'x', password: 'pw', extra: 'x'.repeat(20000) }))).status, 413);
    assert.equal(m.calls.length, 0);
});

test('malformed upstream responses and timeout errors produce fixed messages', async () => {
    for (const [upstream, code, status] of [
        [{ raw: '<html>not json</html>' }, 'MSP_INVALID_RESPONSE', 502],
        [{ body: { id_token: 'not-an-access-token' } }, 'MSP_TOKEN_MISSING', 502],
        [{ throw: Object.assign(new Error('must-not-leak'), { name: 'TimeoutError' }) }, 'MSP_CONNECTION_FAILED', 504]
    ]) {
        const m = mock([upstream]);
        const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
        assert.equal(response.status, status);
        assert.equal((await response.json()).error, code);
        assert.equal(m.calls.length, 1);
    }
});

test('ambiguous profiles and changed profile claims are rejected', async () => {
    const identity = jwt({ sub: 'login-own' });
    const m = mock([{ body: { access_token: identity } }, { body: [{ id: 'a' }, { id: 'b' }] }]);
    const response = await createLoginHandler({ env, fetchImpl: m.fetchImpl })(request());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'MSP_PROFILE_AMBIGUOUS');
    const m2 = mock([
        { body: { access_token: jwt({ profileId: 'profile-own' }), refresh_token: 'refresh-own' } },
        { body: { access_token: jwt({ profileId: 'another-profile', gameId: 'j68d' }) } }
    ]);
    const response2 = await createLoginHandler({ env, fetchImpl: m2.fetchImpl })(request());
    assert.equal((await response2.json()).error, 'MSP_PROFILE_CHANGED');
});
