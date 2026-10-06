import { randomBytes } from 'node:crypto';
console.log('STORE_API_KEY=' + randomBytes(32).toString('hex'));
console.log('STORE_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
