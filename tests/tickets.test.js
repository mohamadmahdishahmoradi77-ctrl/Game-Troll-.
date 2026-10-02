import fs from 'node:fs';
import assert from 'node:assert/strict';

const root=new URL('..',import.meta.url).pathname;
const server=fs.readFileSync(root+'server.js','utf8');
const db=fs.readFileSync(root+'db.js','utf8');
const html=fs.readFileSync(root+'index.html','utf8');

assert.match(server,/app\.get\('\/ticket\/:id'/);
assert.match(server,/app\.post\('\/api\/admin\/tickets\/:id\/messages',requireAdmin/);
assert.match(server,/app\.patch\('\/api\/admin\/tickets\/:id',requireAdmin/);
assert.match(server,/const s=\['investigating','answered','closed'\]/);
assert.match(server,/UPDATE tickets SET status='answered'/);
assert.match(server,/UPDATE tickets SET status='investigating'/);

assert.match(db,/status TEXT NOT NULL DEFAULT 'investigating'/);
assert.match(db,/status NOT IN \('investigating','answered','closed'\)/);

assert.match(html,/id="ticketDetail"/);
assert.match(html,/history\.pushState\(\{ticketId:currentTicketId\},'', '\/ticket\/'/);
assert.match(html,/async function loadTicketDetail\(id\)/);
assert.match(html,/ticketEndpoint\(id\)/);
assert.match(html,/\/admin\/tickets\//);
assert.match(html,/\/tickets\//);
assert.doesNotMatch(html,/async function adminTicketDetail\(id\)/);
assert.doesNotMatch(html,/async function ticketDetail\(id\)/);
assert.doesNotMatch(html,/\['new','investigating','answered','resolved','closed'\]/);

console.log('Ticket page/status/security static checks passed');
