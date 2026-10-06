const servers = new Set('TR US CA GB NL IE DK FR PL SE NO FI ES DE AU NZ'.split(' '));
export function parseAccounts(text, defaultServer = 'TR') {
    if (typeof text !== 'string' || text.length > 1048576) throw new Error('Liste en fazla 1 MB olabilir.');
    const seen = new Map();
    const accounts = [];
    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
        if (!line.trim() || line.trimStart().startsWith('#')) return;
        const colon = line.indexOf(':');
        let username = line.slice(0, colon).trim(), password = line.slice(colon + 1), server = defaultServer;
        if (colon < 1) throw new Error(`Satır ${index + 1}: kullanıcı:şifre biçimini kullan.`);
        if (username.includes('|')) {
            const parts = username.split('|');
            if (parts.length !== 2) throw new Error(`Satır ${index + 1}: sunucu biçimi hatalı.`);
            [server, username] = parts.map(value => value.trim());
        } else {
            const suffix = password.match(/:([A-Za-z]{2})$/);
            if (suffix && servers.has(suffix[1].toUpperCase())) {
                server = suffix[1]; password = password.slice(0, -3);
            }
        }
        server = server.toUpperCase();
        if (!servers.has(server) || !username || username.length > 115 || /[\x00-\x1f\x7f]/.test(username) || !password || password.length > 256)
            throw new Error(`Satır ${index + 1}: sunucu, kullanıcı adı veya şifre geçersiz.`);
        const key = `${server}|${username.toLowerCase()}`;
        if (seen.has(key)) {
            if (seen.get(key) !== password) throw new Error(`Satır ${index + 1}: aynı hesap için farklı şifreler var.`);
            return;
        }
        seen.set(key, password); accounts.push({ username, password, server });
    });
    if (!accounts.length || accounts.length > 500) throw new Error('Liste 1–500 hesap içermeli.');
    return accounts;
}
function pause(ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted) return resolve();
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener('abort', finish, { once: true });
    });
}
export async function runAccounts(accounts, { login, onResult = () => {}, onStart = () => {}, onWait = () => {}, signal, concurrency = 50, wait = pause }) {
    const results = [];
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 50) {
        accounts.forEach(account => { account.password = ''; });
        throw new Error('Paralel hesap sayısı 1–50 arasında olmalı.');
    }
    let reason = 'complete';
    let failureMessage = '';
    async function loginOne(account, i) {
            if (reason === 'error' || signal?.aborted) return;
            onStart(account, i);
            let row, halt = false;
            try {
                row = { ...await login(account), username: account.username, server: account.server, ok: true };
                if (row.saveError) { halt = true; row.message = row.saveError; }
            }
            catch (error) {
                row = { username: account.username, server: account.server, ok: false, message: error.message };
                halt = !(error.status === 401 && error.code === 'MSP_LOGIN_REJECTED');
            }
            account.password = '';
            if (halt && reason !== 'error') { reason = 'error'; failureMessage = row.message; }
            results.push(row); onResult(row, i);
    }
    try {
        for (let start = 0; start < accounts.length; start += concurrency) {
            if (signal?.aborted || reason === 'error') break;
            const batch = accounts.slice(start, start + concurrency);
            const outcomes = await Promise.allSettled(batch.map((account, index) => loginOne(account, start + index)));
            const rejected = outcomes.find(outcome => outcome.status === 'rejected');
            if (rejected) throw rejected.reason;
            if (reason === 'error' || signal?.aborted) break;
            if (start + concurrency < accounts.length) {
                onWait(15000);
                await wait(15000, signal);
            }
        }
        if (signal?.aborted && reason !== 'error') reason = 'stopped';
        return { results, reason, failureMessage };
    } finally { accounts.forEach(account => { account.password = ''; }); }
}
