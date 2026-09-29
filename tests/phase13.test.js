import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('..',import.meta.url).pathname;
const server=fs.readFileSync(root+'server.js','utf8');
const db=fs.readFileSync(root+'db.js','utf8');
const html=fs.readFileSync(root+'index.html','utf8');
const unified=fs.readFileSync(root+'gt-unified.js','utf8');
const pkg=JSON.parse(fs.readFileSync(root+'package.json','utf8'));

assert.match(pkg.scripts.test,/test:phase11/);
assert.match(pkg.scripts.test,/test:phase12/);
assert.match(pkg.scripts.test,/test:phase13/);
assert.match(pkg.scripts.test,/test:phase14/);
assert.match(db,/CREATE TABLE IF NOT EXISTS sessions/);
assert.match(server,/INSERT INTO sessions \(id,user_id,expires_at\)/);
assert.match(server,/SELECT user_id,expires_at FROM sessions WHERE id=\? AND revoked_at IS NULL/);
assert.match(server,/UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=\?/);
assert.equal((server.match(/UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=\? AND revoked_at IS NULL/g)||[]).length,3);
assert.doesNotMatch(server,/PASSWORD_RESET_TOKEN/);
assert.doesNotMatch(server,/console\.log\([^\n]*(PASSWORD|TOKEN|SECRET)/i);
assert.match(server,/itemType!=='pack'/);
assert.match(server,/SELECT id,name,price,status FROM packs WHERE id=\?/);
assert.match(server,/Number\(item\.price\)\|\|0/);
assert.doesNotMatch(server,/Number\(b\.amount\)\|\|0/);
assert.match(server,/app\.get\('\/api\/games\/:id\/access'/);
assert.match(server,/https:\/\/t\.me\/GameTrollAdmin/);
assert.match(server,/requireAdmin/);
assert.match(server,/helmet/);
assert.match(server,/rateLimit/);
assert.match(server,/bcrypt\.hash/);
assert.match(server,/multer/);
assert.match(unified,/📦 دریافت پک/);
assert.match(server,/GameTrollAdmin/);

const routes=[...server.matchAll(/app\.(get|post|patch|delete)\('([^']+)'/g)].map(m=>m[1]+' '+m[2]);
const counts=new Map();for(const r of routes)counts.set(r,(counts.get(r)||0)+1);
for(const [r,n] of counts)assert.equal(n,1,`duplicate route: ${r}`);

console.log('Phase 13 static regression tests: 20/20 passed');
