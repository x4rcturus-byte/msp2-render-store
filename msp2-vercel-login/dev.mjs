import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createLoginHandler } from './lib/login.js';

const port = Number(process.env.PORT || 3000);
const handle = createLoginHandler();
const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/batch.js', ['batch.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
export const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://localhost:${port}`);
        if (url.pathname === '/login' || url.pathname === '/api/login') {
            const options = { method: req.method, headers: req.headers };
            if (!['GET', 'HEAD'].includes(req.method)) Object.assign(options, { body: Readable.toWeb(req), duplex: 'half' });
            const response = await handle(new Request(url, options));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));
        } else if (files.has(url.pathname) && ['GET', 'HEAD'].includes(req.method)) {
            const [file, type] = files.get(url.pathname);
            res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
            const content = await readFile(new URL(`./public/${file}`, import.meta.url));
            res.end(req.method === 'HEAD' ? undefined : content);
        } else { res.writeHead(404); res.end('Not found'); }
    } catch { res.writeHead(500); res.end('Request failed'); }
}).listen(port, '127.0.0.1', () => console.log(`Yerel test: http://localhost:${port}`));
