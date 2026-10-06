import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_URL = 'https://eu-secure.mspapis.com/loginidentity/connect/token';
const PROFILE_BASE = 'https://eu.mspapis.com/profileidentity/v1/logins/';
const SERVERS = new Set(['TR', 'US', 'CA', 'GB', 'NL', 'IE', 'DK', 'FR', 'PL', 'SE', 'NO', 'FI', 'ES', 'DE', 'AU', 'NZ']);
const MAX_BODY = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

class LoginError extends Error {
    constructor(status, code, message, retryAfter = '') {
        super(message);
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
    }
}

// Claims are used only to locate the profile in an MSP response, never to
// authorize requests to this service. Requests require a separate private key.
function claims(token) {
    try {
        const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

function matchingKey(given, configured) {
    const hash = value => createHash('sha256').update(value).digest();
    return given.length <= 512 && timingSafeEqual(hash(given), hash(configured));
}

async function readInput(request) {
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
        throw new LoginError(415, 'JSON_REQUIRED', 'İstek application/json biçiminde olmalı.');
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
        throw new LoginError(413, 'BODY_TOO_LARGE', 'İstek çok büyük.');
    }
    const reader = request.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY) {
                await reader.cancel();
                throw new LoginError(413, 'BODY_TOO_LARGE', 'İstek çok büyük.');
            }
            chunks.push(value);
        }
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        throw new LoginError(400, 'INVALID_JSON', 'Geçerli JSON gerekli.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new LoginError(400, 'INVALID_INPUT', 'Tek bir hesap bilgisi gönderin.');
    }
    const raw = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const wafToken = input.wafToken === undefined ? '' : input.wafToken;
    if (!raw || raw.length > 120 || !password || password.length > 256 || /[\x00-\x1f\x7f]/.test(raw)) {
        throw new LoginError(400, 'INVALID_INPUT', 'Kullanıcı adı ve şifre gerekli.');
    }
    if (typeof wafToken !== 'string' || wafToken.length > 8192 || /[\r\n\x00]/.test(wafToken)) {
        throw new LoginError(400, 'INVALID_WAF_TOKEN', 'WAF token biçimi geçersiz.');
    }
    const pieces = raw.split('|');
    const server = (pieces.length === 2 ? pieces[0] : typeof input.server === 'string' ? input.server : 'TR').toUpperCase();
    const name = pieces.length === 2 ? pieces[1] : raw;
    if (pieces.length > 2 || !SERVERS.has(server) || !name.trim()) {
        throw new LoginError(400, 'INVALID_SERVER', 'Sunucu ve kullanıcı adı biçimini kontrol edin.');
    }
    return { username: `${server}|${name.trim()}`, password, server, wafToken: wafToken.trim() };
}

function upstreamHeaders(wafToken, accessToken = '') {
    const headers = {
        'Accept': 'application/json',
        'Origin': 'https://moviestarplanet2.com',
        'Referer': 'https://moviestarplanet2.com/'
    };
    if (wafToken) headers['x-aws-waf-token'] = wafToken;
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
        headers['x-msp-game-id'] = 'j68d';
    } else headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return headers;
}

async function requestMsp(fetchImpl, url, options) {
    let response;
    try {
        response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) });
    } catch (error) {
        throw new LoginError(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502,
            'MSP_CONNECTION_FAILED', 'MSP bağlantısı tamamlanamadı.');
    }
    if (response.status === 429) {
        const header = response.headers.get('retry-after') || '';
        throw new LoginError(429, 'MSP_RATE_LIMIT', 'MSP istek sınırına ulaşıldı. Bekleyip tekrar deneyin.', /^\d{1,6}$/.test(header) ? header : '');
    }
    if (response.status === 403) {
        throw new LoginError(403, 'MSP_VERIFICATION_REQUIRED', 'MSP isteği reddetti. Geçerli WAF doğrulaması gerekebilir.');
    }
    let data;
    try { data = await response.json(); } catch {
        throw new LoginError(502, 'MSP_INVALID_RESPONSE', 'MSP beklenen JSON yanıtını vermedi.');
    }
    if (!response.ok || data?.error) {
        if (response.status === 401 || data?.error === 'invalid_grant' || data?.error === 'invalid_username') {
            throw new LoginError(401, 'MSP_LOGIN_REJECTED', 'MSP giriş bilgilerini kabul etmedi.');
        }
        throw new LoginError(502, 'MSP_REQUEST_FAILED', 'MSP isteği tamamlanamadı.');
    }
    return data;
}

async function loginAccount(input, env, fetchImpl) {
    const deviceId = randomBytes(32).toString('hex').toUpperCase();
    const client = { client_id: env.MSP_CLIENT_ID || 'unity.client', client_secret: env.MSP_CLIENT_SECRET };
    const postToken = data => requestMsp(fetchImpl, TOKEN_URL, {
        method: 'POST', headers: upstreamHeaders(input.wafToken), body: new URLSearchParams({ ...client, ...data })
    });
    let token = await postToken({
        grant_type: 'password', scope: 'openid nebula offline_access',
        username: input.username, password: input.password,
        acr_values: `gameId:j68d deviceId:${deviceId}`
    });
    if (typeof token?.access_token !== 'string' || !token.access_token) {
        throw new LoginError(502, 'MSP_TOKEN_MISSING', 'MSP erişim tokenı vermedi.');
    }
    let payload = claims(token.access_token);
    let profileId = typeof payload.profileId === 'string' ? payload.profileId : '';
    if (!profileId) {
        const loginId = payload.loginId || payload.sub;
        if (typeof loginId !== 'string' || !loginId || loginId.length > 200) {
            throw new LoginError(502, 'MSP_PROFILE_MISSING', 'MSP yanıtında hesap kimliği bulunamadı.');
        }
        const url = `${PROFILE_BASE}${encodeURIComponent(loginId)}/profiles?pageSize=100&page=1&filter=region:${input.server}`;
        const profiles = await requestMsp(fetchImpl, url, { method: 'GET', headers: upstreamHeaders(input.wafToken, token.access_token) });
        const list = Array.isArray(profiles) ? profiles : [profiles];
        if (list.length !== 1) {
            throw new LoginError(502, 'MSP_PROFILE_AMBIGUOUS', 'Bu sunucuda tek bir profil bulunamadı.');
        }
        const found = list[0]?.id || list[0]?.profileId;
        profileId = typeof found === 'string' ? found : '';
    }
    if (!profileId || profileId.length > 200 || /\s/.test(profileId)) {
        throw new LoginError(502, 'MSP_PROFILE_MISSING', 'MSP profil kimliği bulunamadı.');
    }
    // Bind an identity token to the selected game/profile when needed.
    // At most two successful refresh stages, matching the supplied project.
    for (let step = 0; payload.gameId !== 'j68d' && step < 2; step++) {
        if (typeof token.refresh_token !== 'string' || !token.refresh_token) break;
        const refreshed = await postToken({ grant_type: 'refresh_token', refresh_token: token.refresh_token,
            acr_values: `gameId:j68d profileId:${profileId} deviceId:${deviceId}` });
        if (typeof refreshed?.access_token !== 'string' || !refreshed.access_token) {
            throw new LoginError(502, 'MSP_TOKEN_MISSING', 'MSP oyun tokenı vermedi.');
        }
        token = { ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token };
        payload = claims(token.access_token);
        if (typeof payload.profileId === 'string' && payload.profileId) {
            if (payload.profileId !== profileId) {
                throw new LoginError(502, 'MSP_PROFILE_CHANGED', 'MSP farklı bir profil kimliği döndürdü.');
            }
        }
    }
    if (payload.gameId !== 'j68d') {
        throw new LoginError(502, 'MSP_GAME_TOKEN_MISSING', 'MSP2 oyun oturumu oluşturulamadı.');
    }
    const expiresIn = Number.isFinite(Number(token.expires_in)) ? Math.max(0, Number(token.expires_in)) : null;
    return { profileId, accessToken: token.access_token, expiresIn };
}

export function createLoginHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    return async function handle(request) {
        const headers = { ...NO_STORE };
        const origin = request.headers.get('origin');
        const allowedOrigins = new Set([new URL(request.url).origin,
            ...(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
        const respond = (status, data) => new Response(data === null ? null : JSON.stringify(data), { status, headers });
        if (origin) {
            if (!allowedOrigins.has(origin)) return respond(403, { error: 'ORIGIN_REJECTED', message: 'Bu sayfadan erişime izin verilmedi.' });
            headers['Access-Control-Allow-Origin'] = origin;
            headers.Vary = 'Origin';
        }
        if (request.method === 'OPTIONS') {
            headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
            headers['Access-Control-Allow-Headers'] = 'Content-Type, X-API-Key';
            return respond(204, null);
        }
        if (request.method !== 'POST') {
            headers.Allow = 'POST, OPTIONS';
            return respond(405, { error: 'METHOD_NOT_ALLOWED', message: 'POST isteği gerekli.' });
        }
        if (!env.LOGIN_API_KEY || env.LOGIN_API_KEY.length < 32 || env.LOGIN_API_KEY.length > 512 || !env.MSP_CLIENT_SECRET) {
            return respond(503, { error: 'SERVER_NOT_CONFIGURED', message: 'Sunucu ortam değişkenleri eksik.' });
        }
        if (!matchingKey(request.headers.get('x-api-key') || '', env.LOGIN_API_KEY)) {
            return respond(401, { error: 'API_KEY_REQUIRED', message: 'Geçerli servis anahtarı gerekli.' });
        }
        try {
            let storeConfig;
            try { storeConfig = renderConfig(env); }
            catch { return respond(503, { error: 'RENDER_NOT_CONFIGURED', message: 'Render URL veya servis anahtarı geçersiz.' }); }
            const input = await readInput(request);
            const result = await loginAccount(input, env, fetchImpl);
            return respond(200, await saveToRender(result, input, storeConfig, fetchImpl));
        } catch (error) {
            if (error instanceof LoginError) {
                if (error.retryAfter) headers['Retry-After'] = error.retryAfter;
                return respond(error.status, { error: error.code, message: error.message });
            }
            return respond(500, { error: 'INTERNAL_ERROR', message: 'Giriş işlemi tamamlanamadı.' });
        }
    };
}
import { renderConfig, saveToRender } from './render-store.js';
