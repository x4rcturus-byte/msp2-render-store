import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function createStore(pool, keyHex) {
    if (!/^[a-fA-F0-9]{64}$/.test(keyHex || '')) throw new Error('STORE_ENCRYPTION_KEY must be 64 hex characters.');
    const key = Buffer.from(keyHex, 'hex');
    function encrypt(token, profileId) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(profileId));
        const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
        return [iv, cipher.getAuthTag(), data].map(value => value.toString('base64')).join('.');
    }
    function decrypt(value, profileId) {
        const [iv, tag, data] = value.split('.').map(part => Buffer.from(part, 'base64'));
        const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(profileId)); cipher.setAuthTag(tag);
        return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
    }
    return {
        async init() {
            await pool.query(`CREATE TABLE IF NOT EXISTS msp_sessions (
                profile_id TEXT PRIMARY KEY, username TEXT NOT NULL, server TEXT NOT NULL,
                token_cipher TEXT NOT NULL, expires_at TIMESTAMPTZ, saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`);
        },
        async save(input) {
            const expiresAt = input.expiresIn === null ? null : new Date(Date.now() + input.expiresIn * 1000);
            await pool.query(`INSERT INTO msp_sessions (profile_id, username, server, token_cipher, expires_at)
                VALUES ($1,$2,$3,$4,$5) ON CONFLICT (profile_id) DO UPDATE SET
                username=EXCLUDED.username, server=EXCLUDED.server, token_cipher=EXCLUDED.token_cipher,
                expires_at=EXCLUDED.expires_at, saved_at=NOW()`,
                [input.profileId, input.username, input.server, encrypt(input.accessToken, input.profileId), expiresAt]);
            const count = await pool.query('SELECT COUNT(*)::int AS total FROM msp_sessions');
            return { total: count.rows[0].total };
        },
        async listPublic() {
            const result = await pool.query('SELECT profile_id, username, server, expires_at, saved_at FROM msp_sessions ORDER BY saved_at DESC LIMIT 5000');
            return result.rows.map(row => ({profileId:row.profile_id, username:row.username, server:row.server,
                savedAt:row.saved_at, expiresAt:row.expires_at,
                expired:row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : null}));
        },
        async list() {
            const result = await pool.query('SELECT * FROM msp_sessions ORDER BY saved_at DESC LIMIT 5000');
            return result.rows.map(row => ({profileId:row.profile_id, username:row.username, server:row.server,
                accessToken:decrypt(row.token_cipher, row.profile_id), savedAt:row.saved_at,
                expiresAt:row.expires_at, expired:row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : null}));
        }
    };
}
