import { parseAccounts, runAccounts } from './batch.js';
const get = id => document.getElementById(id);
const form = get('login-form');
let fileText = '', rows = [], running = false, controller;
function message(text, error = false) { get('status').textContent = text; get('status').classList.toggle('error', error); }
function clearResult() { rows = []; get('results-body').replaceChildren(); get('result').hidden = true; get('download').disabled = true; }
function setMode() {
    const single = get('login-mode').value === 'single';
    get('single-fields').hidden = !single; get('batch-fields').hidden = single;
    get('concurrency').disabled = single;
    for (const id of ['username', 'password']) { get(id).disabled = !single; get(id).required = single; }
    get('submit').textContent = single ? 'Oturum aç' : 'Hesaplarla giriş yap';
}
get('login-mode').addEventListener('change', setMode);
get('account-list').addEventListener('input', () => { fileText = ''; get('account-file').value = ''; get('file-status').textContent = ''; });
get('account-file').addEventListener('change', async () => {
    const file = get('account-file').files[0];
    if (!file) return;
    try {
        if (file.size > 1048576) throw new Error('Dosya en fazla 1 MB olabilir.');
        const text = await file.text();
        if (running || get('account-file').files[0] !== file) return;
        const accounts = parseAccounts(text, get('server').value);
        fileText = text; get('account-list').value = '';
        get('file-status').textContent = `${file.name}: ${accounts.length} hesap. Dosya tarayıcıda okundu.`;
        accounts.forEach(account => { account.password = ''; });
        message('Liste hazır. Girişi başlatabilirsin.');
    } catch (error) { fileText = ''; get('account-file').value = ''; message(error.message, true); }
});
function renderRow(row) {
    const tr = document.createElement('tr');
    for (const value of [`${row.server}|${row.username}`, row.ok ? (row.saved === true ? 'Giriş + kayıt başarılı' : row.saved === false ? 'Giriş başarılı / kayıt başarısız' : 'Giriş başarılı') : 'Başarısız', row.ok ? row.profileId : row.message]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    if (row.ok) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = 'Tokenı kopyala';
        button.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(row.accessToken); message('Token panoya kopyalandı.'); }
            catch { message('Panoya erişilemedi. Sonuçları JSON olarak indirebilirsin.', true); }
        });
        const td = document.createElement('td'); td.append(button); tr.append(td);
    } else tr.append(document.createElement('td'));
    get('results-body').append(tr);
}
form.addEventListener('submit', async event => {
    event.preventDefault(); if (running) return;
    let accounts;
    try {
        accounts = get('login-mode').value === 'single'
            ? parseAccounts(`${get('server').value}|${get('username').value}:${get('password').value}`)
            : parseAccounts(fileText || get('account-list').value, get('server').value);
    } catch (error) { message(error.message, true); return; }
    const apiKey = get('api-key').value, wafToken = get('waf-token').value, total = accounts.length;
    const concurrency = get('login-mode').value === 'single' ? 1 : Number(get('concurrency').value);
    fileText = ''; get('account-list').value = ''; get('account-file').value = ''; get('password').value = ''; get('file-status').textContent = '';
    clearResult(); get('result').hidden = false; get('progress').max = total; get('progress').value = 0;
    get('result-summary').textContent = `0 / ${total} hesap tamamlandı.`;
    running = true; controller = new AbortController();
    for (const element of form.elements) element.disabled = true;
    get('stop').hidden = false; get('stop').disabled = false; get('clear').disabled = true;
    try {
        const outcome = await runAccounts(accounts, {
            signal: controller.signal,
            concurrency,
            onWait: ms => message(`Grup tamamlandı. Sonraki grup ${ms / 1000} saniye sonra başlayacak…`),
            login: async account => {
                const response = await fetch('/login', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
                    body: JSON.stringify({ ...account, wafToken }), cache: 'no-store', signal: AbortSignal.timeout(55000)
                });
                let body;
                try { body = await response.json(); } catch { throw new Error('Sunucu beklenen yanıtı vermedi.'); }
                if (!response.ok) throw Object.assign(new Error(body.message || `HTTP ${response.status}`), { status: response.status, code: body.error });
                if (!body.profileId || !body.accessToken) throw new Error('Sunucunun giriş yanıtı eksik.');
                return { profileId: body.profileId, accessToken: body.accessToken, expiresIn: body.expiresIn, saved:body.saved, saveError:body.saveError };
            },
            onStart: (account, index) => message(`${index + 1}/${total} başlatıldı · En fazla ${concurrency} hesap aynı anda işleniyor…`),
            onResult: row => {
                rows.push(row); renderRow(row); get('progress').value = rows.length;
                const successful = rows.filter(item => item.ok).length;
                const stored = rows.filter(item => item.saved === true).length;
                get('result-summary').textContent = `${rows.length}/${total} tamamlandı · ${successful} giriş başarılı · ${rows.length - successful} başarısız · ${stored} Render kaydı`;
                get('download').disabled = !successful;
            }
        });
        if (outcome.reason === 'error') message(`İşlem durdu: ${outcome.failureMessage}`, true);
        else message(outcome.reason === 'stopped' ? 'İşlem durduruldu. Kalan hesaplara istek gönderilmedi.' : 'Listedeki hesaplar tamamlandı.');
    } catch (error) { message(error.name === 'TimeoutError' ? 'Yanıt süresi aşıldı; işlem durdu.' : error.message, true); }
    finally {
        running = false; controller = null;
        for (const element of form.elements) element.disabled = false;
        get('stop').hidden = true; get('clear').disabled = false; setMode();
    }
});
get('stop').addEventListener('click', () => { controller?.abort(); get('stop').disabled = true; message('Yeni girişler durduruldu; devam eden isteklerin tamamlanması bekleniyor.'); });
get('clear').addEventListener('click', () => { clearResult(); message('Sonuçlar temizlendi.'); });
get('download').addEventListener('click', () => {
    const accounts = rows.filter(row => row.ok).map(({ username, server, profileId, accessToken, expiresIn }) => ({ username, server, profileId, accessToken, bearerToken: accessToken, expiresIn }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ accounts }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'msp2-oturumlar.json'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); message('Tokenları içeren JSON indirildi. Bu dosyayı özel tut.');
});
setMode();
