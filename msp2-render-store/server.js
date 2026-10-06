import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import pg from 'pg';
import { createStore } from './store.js';
import { createHandler } from './handler.js';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,statement_timeout:10000});
pool.on('error', () => console.error('Database connection failed.'));
const store=createStore(pool,process.env.STORE_ENCRYPTION_KEY);
const handler=createHandler({store,apiKey:process.env.STORE_API_KEY});
await store.init();
const server=createServer(async (req,res)=>{
    try {
        const options={method:req.method,headers:req.headers};
        if (!['GET','HEAD'].includes(req.method)) Object.assign(options,{body:Readable.toWeb(req),duplex:'half'});
        const response=await handler(new Request(`http://render.local${req.url}`,options));
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(500);res.end('Request failed');}
});
server.requestTimeout=20000;
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Session store ready.'));
process.on('SIGTERM',()=>{server.close(async()=>{await pool.end();});});
