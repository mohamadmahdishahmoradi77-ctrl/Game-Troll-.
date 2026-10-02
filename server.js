import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {db} from './db.js';

const app=express();
const PORT=Number(process.env.PORT||3000); const ROOT=path.dirname(new URL(import.meta.url).pathname);
const COOKIE=process.env.NODE_ENV==='production';
app.set('trust proxy',1); app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'},contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'})); app.use(express.urlencoded({extended:false,limit:'1mb'}));
app.use('/uploads',express.static(path.join(ROOT,'uploads'),{index:false})); app.use(express.static(ROOT));
const loginLimiter=rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false});
const apiLimiter=rateLimit({windowMs:60*1000,max:180,standardHeaders:true,legacyHeaders:false}); app.use('/api',apiLimiter);
const random=()=>crypto.randomBytes(32).toString('hex'); const hashToken=t=>crypto.createHash('sha256').update(t).digest('hex');
const mailer=(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS)?nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
function send(res,status,error){return res.status(status).json({error})}
async function sessionUser(req){const h=req.headers.authorization?.replace(/^Bearer\s+/i,''); if(!h)return null;const s=await db.get('SELECT user_id,expires_at FROM sessions WHERE id=? AND revoked_at IS NULL',[hashToken(h)]);if(!s)return null;const expires=Date.parse(s.expires_at);if(!Number.isFinite(expires)||expires<Date.now()){await db.run('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?',[hashToken(h)]);return null}return db.get('SELECT id,username,email,role,status,avatar_url,created_at FROM users WHERE id=?',[s.user_id])}
async function requireAuth(req,res,next){const u=await sessionUser(req);if(!u)return send(res,401,'UNAUTHORIZED');if(u.status!=='active')return send(res,403,'ACCOUNT_BLOCKED');req.user=u;req.token=req.headers.authorization.replace(/^Bearer\s+/i,'');next()}
async function requireAdmin(req,res,next){await requireAuth(req,res,()=>{if(req.user.role!=='admin')return send(res,403,'FORBIDDEN');next()})}
function validateEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||''))}
function clean(s,max=5000){return String(s??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').slice(0,max)}
async function audit(admin,action,type,id,meta={}){await db.run('INSERT INTO audit_logs (id,admin_user_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?,?)',[crypto.randomUUID(),admin,action,type,id,JSON.stringify(meta).slice(0,5000)])}
async function notify(userId,type,title,body){
  if(!userId)return;
  const setting=type==='support'?'support_notifications':type==='order'?'order_notifications':'content_notifications';
  const u=await db.get(`SELECT COALESCE(${setting},1) enabled FROM user_settings WHERE user_id=?`,[userId]);
  if(u && Number(u.enabled)===0)return;
  await db.run('INSERT INTO notifications (id,user_id,type,title,body) VALUES (?,?,?,?,?)',[crypto.randomUUID(),userId,type,title,body||''])
}
async function notifyAll(type,title,body){const users=await db.all("SELECT u.id,s.content_notifications FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.status='active'");for(const u of users){if(u.content_notifications===0)continue;await notify(u.id,type,title,body)}}
async function initStatus(){for(const k of ['api','database','login','content','orders','support'])await db.run("INSERT INTO site_status (key,status,message) VALUES (?, 'operational','') ON CONFLICT(key) DO NOTHING",[k])}
await initStatus();
async function ensureAdmin(){const u=await db.get('SELECT id FROM users WHERE username=?',[process.env.ADMIN_USER||'admin']);if(!u&&process.env.ADMIN_PASSWORD){const id=crypto.randomUUID();await db.run('INSERT INTO users (id,username,email,password_hash,role) VALUES (?,?,?,?,?)',[id,process.env.ADMIN_USER||'admin',process.env.ADMIN_EMAIL||'admin@gametroll.local',await bcrypt.hash(process.env.ADMIN_PASSWORD,12),'admin'])}}
await ensureAdmin();

app.get('/api/health',async(_q,r)=>{try{await db.get('SELECT 1 as ok');r.json({ok:true,service:'GAME TROLL API',database:'operational',time:new Date().toISOString()})}catch(e){r.status(503).json({ok:false,database:'down'})}});
app.get('/api/status',async(_q,r)=>{const keys=['api','database','login','content','orders','support'];const out={};for(const k of keys){const x=await db.get('SELECT status,message,updated_at FROM site_status WHERE key=?',[k]);out[k]=x||{status:k==='database'?'operational':'operational'}}r.json(out)});

app.post('/api/auth/register',loginLimiter,async(req,res)=>{const username=clean(req.body?.username,50).trim(),email=clean(req.body?.email,200).trim().toLowerCase(),password=String(req.body?.password||'');if(!/^[a-zA-Z0-9_\-]{3,30}$/.test(username)||!validateEmail(email)||password.length<8)return send(res,422,'INVALID_INPUT');if(await db.get('SELECT id FROM users WHERE username=? OR email=?',[username,email]))return send(res,409,'USER_EXISTS');const id=crypto.randomUUID();await db.run('INSERT INTO users (id,username,email,password_hash) VALUES (?,?,?,?)',[id,username,email,await bcrypt.hash(password,12)]);await db.run('INSERT INTO user_settings (user_id) VALUES (?)',[id]);res.status(201).json({ok:true,id})});
app.post('/api/auth/login',loginLimiter,async(req,res)=>{const identity=clean(req.body?.identity,200).trim(),password=String(req.body?.password||'');const u=await db.get('SELECT * FROM users WHERE username=? OR email=?',[identity,identity.toLowerCase()]);if(!u||u.status!=='active'||!(await bcrypt.compare(password,u.password_hash)))return send(res,401,'INVALID_LOGIN');const t=random();await db.run('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)',[hashToken(t),u.id,new Date(Date.now()+1000*60*60*24*7).toISOString()]);if(u.role==='admin')await audit(u.id,'LOGIN_ADMIN','user',u.id);res.json({ok:true,token:t,user:{id:u.id,username:u.username,email:u.email,role:u.role,avatar_url:u.avatar_url,created_at:u.created_at}})});
app.post('/api/auth/logout',requireAuth,async(req,res)=>{await db.run('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?',[hashToken(req.token)]);res.json({ok:true})});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json(req.user));
app.patch('/api/auth/profile',requireAuth,async(req,res)=>{const username=clean(req.body?.username,50).trim(),email=clean(req.body?.email,200).trim().toLowerCase(),avatar=clean(req.body?.avatar_url,500);if(username&&!/^[a-zA-Z0-9_\-]{3,30}$/.test(username))return send(res,422,'INVALID_USERNAME');if(email&&!validateEmail(email))return send(res,422,'INVALID_EMAIL');try{await db.run('UPDATE users SET username=COALESCE(?,username),email=COALESCE(?,email),avatar_url=COALESCE(?,avatar_url),updated_at=CURRENT_TIMESTAMP WHERE id=?',[username||null,email||null,avatar||null,req.user.id]);res.json(await db.get('SELECT id,username,email,role,status,avatar_url,created_at FROM users WHERE id=?',[req.user.id]))}catch(e){if(String(e.message).includes('UNIQUE'))return send(res,409,'USER_EXISTS');throw e}});
app.patch('/api/auth/password',requireAuth,async(req,res)=>{const old=String(req.body?.old_password||''),nw=String(req.body?.new_password||''),u=await db.get('SELECT password_hash FROM users WHERE id=?',[req.user.id]);if(nw.length<8||!(await bcrypt.compare(old,u.password_hash)))return send(res,422,'INVALID_PASSWORD');await db.run('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[await bcrypt.hash(nw,12),req.user.id]);await db.run('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL',[req.user.id]);res.json({ok:true})});
app.delete('/api/auth/account',requireAuth,async(req,res)=>{const p=String(req.body?.password||''),u=await db.get('SELECT password_hash FROM users WHERE id=?',[req.user.id]);if(!(await bcrypt.compare(p,u.password_hash)))return send(res,403,'INVALID_PASSWORD');await db.run('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL',[req.user.id]);await db.transaction(async(tx)=>{for(const q of ['DELETE FROM favorites WHERE user_id=?','DELETE FROM ratings WHERE user_id=?','DELETE FROM reviews WHERE user_id=?','DELETE FROM notifications WHERE user_id=?','DELETE FROM user_settings WHERE user_id=?','DELETE FROM users WHERE id=?'])await tx.run(q,[req.user.id])});res.json({ok:true})});
app.post('/api/auth/forgot',loginLimiter,async(req,res)=>{const email=clean(req.body?.email,200).toLowerCase();const u=await db.get('SELECT id FROM users WHERE email=?',[email]);if(u){const raw=random();await db.run('UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE user_id=? AND used_at IS NULL',[u.id]);await db.run('INSERT INTO password_resets (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)',[crypto.randomUUID(),u.id,hashToken(raw),new Date(Date.now()+30*60*1000).toISOString()]);if(mailer){const base=process.env.APP_URL||'http://localhost:3000';const link=base+'/?reset='+encodeURIComponent(raw);try{await mailer.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to:email,subject:'GAME TROLL | بازیابی رمز عبور',text:`برای تنظیم رمز جدید از این لینک استفاده کنید: ${link}`,html:`<p>برای تنظیم رمز جدید GAME TROLL:</p><p><a href="${link}">تنظیم رمز جدید</a></p><p>این لینک ۳۰ دقیقه اعتبار دارد.</p>`})}catch(e){console.error('Password reset email failed:',e.message)}}}res.json({ok:true,message:'اگر ایمیل وجود داشته باشد، لینک بازیابی ارسال می‌شود.'})});
app.post('/api/auth/reset',loginLimiter,async(req,res)=>{const token=String(req.body?.token||''),password=String(req.body?.password||'');if(password.length<8)return send(res,422,'INVALID_PASSWORD');const x=await db.get('SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP',[hashToken(token)]);if(!x)return send(res,400,'INVALID_RESET_TOKEN');await db.run('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[await bcrypt.hash(password,12),x.user_id]);await db.run('UPDATE password_resets SET used_at=CURRENT_TIMESTAMP WHERE id=?',[x.id]);await db.run('UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL',[x.user_id]);res.json({ok:true})});

function tableFor(type){return {games:'games',packs:'packs',news:'news',tutorials:'tutorials'}[type]}
app.get('/api/content/:type',async(req,res)=>{const t=tableFor(req.params.type);if(!t)return send(res,404,'UNKNOWN_CONTENT_TYPE');const order=t==='news'||t==='tutorials'?'COALESCE(published_at,created_at) DESC, created_at DESC':'created_at DESC';let rows=await db.all(`SELECT * FROM ${t} WHERE status='published' ORDER BY ${order}`);if(t==='games')rows=rows.map(x=>({...x,desc:x.short_description||x.description}));if(t==='packs')rows=rows.map(x=>({...x,old:x.old_price,desc:x.description}));if(t==='tutorials')rows=rows.map(x=>({...x,desc:x.description||x.content}));res.json(rows)});
app.get('/api/games/search',async(req,res)=>{
  const q=clean(req.query.q,100).trim();
  const consoleName=clean(req.query.console,100).trim();
  const platform=clean(req.query.platform,100).trim();
  const genre=clean(req.query.genre,100).trim();
  const pack=clean(req.query.pack,100).trim();
  const version=clean(req.query.version,100).trim();
  const year=Number(req.query.year);
  const yearFrom=Number(req.query.year_from);
  const yearTo=Number(req.query.year_to);
  const page=Math.max(1,Number(req.query.page)||1);
  const limit=Math.min(48,Math.max(1,Number(req.query.limit)||24));
  const sortMap={new:'created_at DESC',old:'created_at ASC',alpha:'name ASC',year:'year DESC',year_old:'year ASC'};
  const sort=sortMap[String(req.query.sort||'new')]||sortMap.new;
  const where=["status='published'"]; const params=[];
  if(q){where.push("(LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(tags,'')) LIKE LOWER(?) OR LOWER(COALESCE(short_description,'')) LIKE LOWER(?) OR LOWER(COALESCE(description,'')) LIKE LOWER(?) OR LOWER(COALESCE(console,'')) LIKE LOWER(?) OR LOWER(COALESCE(platform,'')) LIKE LOWER(?) OR LOWER(COALESCE(genre,'')) LIKE LOWER(?))"); const z='%'+q+'%'; params.push(z,z,z,z,z,z,z)}
  for(const [v,col] of [[consoleName,'console'],[platform,'platform'],[genre,'genre'],[pack,'pack'],[version,'version']]) if(v){where.push(`${col} LIKE ?`);params.push('%'+v+'%')}
  if(Number.isInteger(year)&&year>0){where.push('year=?');params.push(year)}
  if(Number.isInteger(yearFrom)&&yearFrom>0){where.push('year>=?');params.push(yearFrom)}
  if(Number.isInteger(yearTo)&&yearTo>0){where.push('year<=?');params.push(yearTo)}
  const base=where.join(' AND ');
  const total=Number((await db.get(`SELECT COUNT(*) count FROM games WHERE ${base}`,params))?.count||0);
  const offset=(page-1)*limit;
  const items=await db.all(`SELECT * FROM games WHERE ${base} ORDER BY ${sort} LIMIT ? OFFSET ?`,[...params,limit,offset]);
  res.json({items,total,page,limit,pages:Math.max(1,Math.ceil(total/limit)),sort,filters:{q,console:consoleName,platform,genre,pack,version,year:Number.isInteger(year)&&year>0?year:null,year_from:Number.isInteger(yearFrom)&&yearFrom>0?yearFrom:null,year_to:Number.isInteger(yearTo)&&yearTo>0?yearTo:null}});
});
app.get('/api/games/filters',async(_req,res)=>{
  const [consoles,platforms,genres,years,packs]=await Promise.all([
    db.all("SELECT DISTINCT console value FROM games WHERE status='published' AND COALESCE(console,'')<>'' ORDER BY console"),
    db.all("SELECT DISTINCT platform value FROM games WHERE status='published' AND COALESCE(platform,'')<>'' ORDER BY platform"),
    db.all("SELECT DISTINCT genre value FROM games WHERE status='published' AND COALESCE(genre,'')<>'' ORDER BY genre"),
    db.all("SELECT DISTINCT year value FROM games WHERE status='published' AND year IS NOT NULL ORDER BY year DESC"),
    db.all("SELECT p.id value,p.name label FROM packs p WHERE p.status='published' ORDER BY p.created_at DESC")
  ]);
  res.json({consoles:consoles.map(x=>x.value),platforms:platforms.map(x=>x.value),genres:genres.map(x=>x.value),years:years.map(x=>x.value),packs});
});
app.get('/api/search',async(req,res)=>{
  const q=clean(req.query.q,100).trim(); const type=['games','packs','news','tutorials'].includes(req.query.type)?req.query.type:'all'; const limit=Math.min(20,Math.max(1,Number(req.query.limit)||8));
  const like='%'+q+'%'; const out={games:[],packs:[],news:[],tutorials:[]};
  if(type==='all'||type==='games')out.games=await db.all("SELECT id,name,short_description description,img,console,platform,genre FROM games WHERE status='published' AND (LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(tags,'')) LIKE LOWER(?) OR LOWER(COALESCE(description,'')) LIKE LOWER(?)) ORDER BY created_at DESC LIMIT ?",[like,like,like,limit]);
  if(type==='all'||type==='packs')out.packs=await db.all("SELECT id,name,short,description,img,price,old_price FROM packs WHERE status='published' AND (LOWER(name) LIKE LOWER(?) OR LOWER(COALESCE(short,'')) LIKE LOWER(?) OR LOWER(COALESCE(description,'')) LIKE LOWER(?)) ORDER BY created_at DESC LIMIT ?",[like,like,like,limit]);
  if(type==='all'||type==='news')out.news=await db.all("SELECT id,title,summary,content,img,published_at FROM news WHERE status='published' AND (LOWER(title) LIKE LOWER(?) OR LOWER(COALESCE(summary,'')) LIKE LOWER(?) OR LOWER(COALESCE(content,'')) LIKE LOWER(?)) ORDER BY COALESCE(published_at,created_at) DESC LIMIT ?",[like,like,like,limit]);
  if(type==='all'||type==='tutorials')out.tutorials=await db.all("SELECT id,title,category,content,img,published_at FROM tutorials WHERE status='published' AND (LOWER(title) LIKE LOWER(?) OR LOWER(COALESCE(category,'')) LIKE LOWER(?) OR LOWER(COALESCE(content,'')) LIKE LOWER(?)) ORDER BY COALESCE(published_at,created_at) DESC LIMIT ?",[like,like,like,limit]);
  res.json(out);
});

app.post('/api/favorites/:gameId',requireAuth,async(req,res)=>{await db.run('INSERT INTO favorites (user_id,game_id) VALUES (?,?) ON CONFLICT(user_id,game_id) DO NOTHING',[req.user.id,clean(req.params.gameId,100)]);res.json({ok:true})});
app.delete('/api/favorites/:gameId',requireAuth,async(req,res)=>{await db.run('DELETE FROM favorites WHERE user_id=? AND game_id=?',[req.user.id,req.params.gameId]);res.json({ok:true})});
app.get('/api/favorites',requireAuth,async(req,res)=>res.json(await db.all('SELECT g.* FROM games g JOIN favorites f ON f.game_id=g.id WHERE f.user_id=? ORDER BY f.created_at DESC',[req.user.id])));
app.post('/api/favorites/merge',requireAuth,async(req,res)=>{for(const id of Array.isArray(req.body?.game_ids)?req.body.game_ids.slice(0,100):[])await db.run('INSERT INTO favorites (user_id,game_id) VALUES (?,?) ON CONFLICT DO NOTHING',[req.user.id,clean(id,100)]);res.json({ok:true})});

app.get('/api/profile/orders',requireAuth,async(req,res)=>res.json(await db.all('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC',[req.user.id])));
app.get('/api/profile/tickets',requireAuth,async(req,res)=>res.json(await db.all('SELECT * FROM tickets WHERE user_id=? ORDER BY created_at DESC',[req.user.id])));
app.post('/api/broken-links',requireAuth,async(req,res)=>{const gameId=clean(req.body?.game_id,100)||null,packId=clean(req.body?.pack_id,100)||null,url=clean(req.body?.url,1000)||null,reason=clean(req.body?.reason,2000);if(!reason)return send(res,422,'REASON_REQUIRED');const id='BL-'+crypto.randomBytes(5).toString('hex').toUpperCase();await db.run('INSERT INTO broken_links (id,user_id,game_id,pack_id,url,reason) VALUES (?,?,?,?,?,?)',[id,req.user.id,gameId,packId,url,reason]);await notify(req.user.id,'support','گزارش لینک ثبت شد','گزارش لینک خراب شما برای بررسی مدیریت ثبت شد.');res.status(201).json({ok:true,id})});
app.get('/api/profile/reviews',requireAuth,async(req,res)=>res.json(await db.all('SELECT * FROM reviews WHERE user_id=? ORDER BY created_at DESC',[req.user.id])));
app.get('/api/notifications',requireAuth,async(req,res)=>res.json(await db.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',[req.user.id])));
app.patch('/api/notifications/:id/read',requireAuth,async(req,res)=>{await db.run('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?',[req.params.id,req.user.id]);res.json({ok:true})});
app.post('/api/notifications/read-all',requireAuth,async(req,res)=>{await db.run('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=?',[req.user.id]);res.json({ok:true})});
app.get('/api/settings/notifications',requireAuth,async(req,res)=>res.json(await db.get('SELECT * FROM user_settings WHERE user_id=?',[req.user.id])||{}));
app.patch('/api/settings/notifications',requireAuth,async(req,res)=>{const a=req.body||{};await db.run('INSERT INTO user_settings (user_id,support_notifications,order_notifications,content_notifications) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET support_notifications=EXCLUDED.support_notifications,order_notifications=EXCLUDED.order_notifications,content_notifications=EXCLUDED.content_notifications',[req.user.id,!!a.support_notifications,!!a.order_notifications,!!a.content_notifications]);res.json({ok:true})});

app.post('/api/orders',requireAuth,async(req,res)=>{const b=req.body||{},itemType=clean(b.item_type,30).trim(),itemId=clean(b.item_id,100).trim();if(itemType!=='pack'||!itemId)return send(res,422,'ITEM_REQUIRED');const item=await db.get("SELECT id,name,price,status FROM packs WHERE id=?",[itemId]);if(!item||item.status!=='published')return send(res,404,'PACK_NOT_FOUND');const id=crypto.randomUUID();await db.run('INSERT INTO orders (id,user_id,customer_name,customer_contact,item_type,item_id,item_name,amount,status,receipt,note) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,req.user.id,req.user.username,req.user.email,itemType,item.id,item.name,Number(item.price)||0,'pending',clean(b.receipt,500),clean(b.note,1000)]);res.status(201).json({ok:true,id,amount:Number(item.price)||0,item_name:item.name})});

app.post('/api/tickets',requireAuth,async(req,res)=>{const b=req.body||{};if(!b.subject||!b.description)return send(res,422,'INVALID_TICKET');const id='GT-'+crypto.randomBytes(4).toString('hex').toUpperCase();await db.run('INSERT INTO tickets (id,user_id,subject,type,description,game_id,pack_id,priority) VALUES (?,?,?,?,?,?,?,?)',[id,req.user.id,clean(b.subject,200),clean(b.type,50),clean(b.description,5000),clean(b.game_id,100),clean(b.pack_id,100),['low','normal','high','urgent'].includes(b.priority)?b.priority:'normal']);res.status(201).json({ok:true,id})});
app.get('/api/tickets/:id',requireAuth,async(req,res)=>{const t=await db.get('SELECT * FROM tickets WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!t)return send(res,404,'NOT_FOUND');t.messages=await db.all('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at',[t.id]);res.json(t)});
app.post('/api/tickets/:id/messages',requireAuth,async(req,res)=>{const t=await db.get('SELECT * FROM tickets WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!t)return send(res,404,'NOT_FOUND');const m=clean(req.body?.message,5000);if(!m)return send(res,422,'MESSAGE_REQUIRED');await db.run('INSERT INTO ticket_messages (id,ticket_id,user_id,message) VALUES (?,?,?,?)',[crypto.randomUUID(),t.id,req.user.id,m]);await db.run("UPDATE tickets SET status='new',updated_at=CURRENT_TIMESTAMP WHERE id=?",[t.id]);res.json({ok:true})});

async function ownsGame(userId,gameId){
  return !!await db.get(`SELECT g.id FROM games g WHERE g.id=? AND EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id=? AND o.status IN ('paid','completed') AND (
      (o.item_type='game' AND o.item_id=g.id) OR
      (o.item_type='pack' AND EXISTS (SELECT 1 FROM pack_games pg WHERE pg.pack_id=o.item_id AND pg.game_id=g.id))
    )
  )`,[gameId,userId]);
}
async function ownsPack(userId,packId){
  return !!await db.get("SELECT id FROM packs WHERE id=? AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id=? AND o.item_type='pack' AND o.item_id=? AND o.status IN ('paid','completed'))",[packId,userId,packId]);
}

app.get('/api/games/:id/access',async(req,res)=>{
  const g=await db.get('SELECT id,pack FROM games WHERE id=? AND status=\'published\'',[req.params.id]);
  if(!g)return send(res,404,'NOT_FOUND');
  const u=await sessionUser(req);
  if(!u)return res.json({owned:false,pack_id:g.pack||null,delivery_url:null});
  const owned=await ownsGame(u.id,g.id);
  const packId=g.pack||null;
  res.json({owned,pack_id:packId,delivery_url:owned&&packId?'https://t.me/GameTrollAdmin':null});
});

function publicVoterId(req){const id=String(req.get('X-Voter-ID')||'').trim();return /^[A-Za-z0-9_-]{8,100}$/.test(id)?'anon:'+id:null}
app.post('/api/games/:id/rating',async(req,res)=>{
  const rating=Number(req.body?.rating);if(!Number.isInteger(rating)||rating<1||rating>5)return send(res,422,'INVALID_RATING');
  if(!(await db.get("SELECT id FROM games WHERE id=? AND status='published'",[req.params.id])))return send(res,404,'NOT_FOUND');
  const voter=publicVoterId(req);if(!voter)return send(res,400,'VOTER_ID_REQUIRED');
  await db.run('INSERT INTO ratings (user_id,game_id,rating) VALUES (?,?,?) ON CONFLICT(user_id,game_id) DO UPDATE SET rating=EXCLUDED.rating,updated_at=CURRENT_TIMESTAMP',[voter,req.params.id,rating]);res.json({ok:true});
});
app.get('/api/games/:id/rating',async(req,res)=>{const a=await db.get('SELECT AVG(rating) avg,COUNT(*) count FROM ratings WHERE game_id=?',[req.params.id]);const voter=publicVoterId(req);const m=voter?await db.get('SELECT rating FROM ratings WHERE game_id=? AND user_id=?',[req.params.id,voter]):null;res.json({average:Number(a?.avg||0),count:Number(a?.count||0),mine:m?.rating||null})});
app.post('/api/packs/:id/rating',async(req,res)=>{const rating=Number(req.body?.rating);if(!Number.isInteger(rating)||rating<1||rating>5)return send(res,422,'INVALID_RATING');if(!(await db.get("SELECT id FROM packs WHERE id=? AND status='published'",[req.params.id])))return send(res,404,'NOT_FOUND');const voter=publicVoterId(req);if(!voter)return send(res,400,'VOTER_ID_REQUIRED');await db.run('INSERT INTO pack_ratings (user_id,pack_id,rating) VALUES (?,?,?) ON CONFLICT(user_id,pack_id) DO UPDATE SET rating=EXCLUDED.rating,updated_at=CURRENT_TIMESTAMP',[voter,req.params.id,rating]);res.json({ok:true})});
app.get('/api/packs/:id/rating',async(req,res)=>{const a=await db.get('SELECT AVG(rating) avg,COUNT(*) count FROM pack_ratings WHERE pack_id=?',[req.params.id]);const voter=publicVoterId(req);const m=voter?await db.get('SELECT rating FROM pack_ratings WHERE pack_id=? AND user_id=?',[req.params.id,voter]):null;res.json({average:Number(a?.avg||0),count:Number(a?.count||0),mine:m?.rating||null})});

app.post('/api/games/:id/reviews',requireAuth,async(req,res)=>{const body=clean(req.body?.body,3000);if(body.length<2)return send(res,422,'INVALID_REVIEW');if(!(await ownsGame(req.user.id,req.params.id)))return send(res,403,'PURCHASE_REQUIRED');const id=crypto.randomUUID();await db.run('INSERT INTO reviews (id,user_id,game_id,body) VALUES (?,?,?,?)',[id,req.user.id,req.params.id,body]);res.status(201).json({ok:true,id,status:'pending'});});
app.patch('/api/reviews/:id',requireAuth,async(req,res)=>{const body=clean(req.body?.body,3000);if(body.length<2)return send(res,422,'INVALID_REVIEW');const r=await db.get('SELECT * FROM reviews WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run("UPDATE reviews SET body=?,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",[body,r.id,req.user.id]);res.json({ok:true,status:'pending'})});
app.delete('/api/reviews/:id',requireAuth,async(req,res)=>{const r=await db.get('SELECT id FROM reviews WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run('DELETE FROM review_reports WHERE review_id=?',[r.id]);await db.run('DELETE FROM reviews WHERE id=? AND user_id=?',[r.id,req.user.id]);res.json({ok:true})});
app.get('/api/games/:id/reviews',async(req,res)=>res.json(await db.all("SELECT r.id,r.body,r.status,r.created_at,r.updated_at,u.username FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.game_id=? AND r.status='approved' ORDER BY r.created_at DESC",[req.params.id])));
app.post('/api/reviews/:id/report',requireAuth,async(req,res)=>{const reason=clean(req.body?.reason,500);if(!reason)return send(res,422,'REASON_REQUIRED');const r=await db.get('SELECT id FROM reviews WHERE id=? AND status=\'approved\'',[req.params.id]);if(!r)return send(res,404,'NOT_FOUND');if(await db.get('SELECT id FROM review_reports WHERE review_id=? AND user_id=?',[r.id,req.user.id]))return send(res,409,'ALREADY_REPORTED');await db.run('INSERT INTO review_reports (id,review_id,user_id,reason) VALUES (?,?,?,?)',[crypto.randomUUID(),r.id,req.user.id,reason]);res.json({ok:true})});

app.post('/api/packs/:id/reviews',requireAuth,async(req,res)=>{const body=clean(req.body?.body,3000);if(body.length<2)return send(res,422,'INVALID_REVIEW');if(!(await ownsPack(req.user.id,req.params.id)))return send(res,403,'PURCHASE_REQUIRED');const id=crypto.randomUUID();await db.run('INSERT INTO pack_reviews (id,user_id,pack_id,body) VALUES (?,?,?,?)',[id,req.user.id,req.params.id,body]);res.status(201).json({ok:true,id,status:'pending'});});
app.patch('/api/pack-reviews/:id',requireAuth,async(req,res)=>{const body=clean(req.body?.body,3000);if(body.length<2)return send(res,422,'INVALID_REVIEW');const r=await db.get('SELECT * FROM pack_reviews WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run("UPDATE pack_reviews SET body=?,status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",[body,r.id,req.user.id]);res.json({ok:true,status:'pending'})});
app.delete('/api/pack-reviews/:id',requireAuth,async(req,res)=>{const r=await db.get('SELECT id FROM pack_reviews WHERE id=? AND user_id=?',[req.params.id,req.user.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run('DELETE FROM pack_review_reports WHERE review_id=?',[r.id]);await db.run('DELETE FROM pack_reviews WHERE id=? AND user_id=?',[r.id,req.user.id]);res.json({ok:true})});
app.get('/api/packs/:id/reviews',async(req,res)=>res.json(await db.all("SELECT r.id,r.body,r.status,r.created_at,r.updated_at,u.username FROM pack_reviews r JOIN users u ON u.id=r.user_id WHERE r.pack_id=? AND r.status='approved' ORDER BY r.created_at DESC",[req.params.id])));
app.post('/api/pack-reviews/:id/report',requireAuth,async(req,res)=>{const reason=clean(req.body?.reason,500);if(!reason)return send(res,422,'REASON_REQUIRED');const r=await db.get('SELECT id FROM pack_reviews WHERE id=? AND status=\'approved\'',[req.params.id]);if(!r)return send(res,404,'NOT_FOUND');if(await db.get('SELECT id FROM pack_review_reports WHERE review_id=? AND user_id=?',[r.id,req.user.id]))return send(res,409,'ALREADY_REPORTED');await db.run('INSERT INTO pack_review_reports (id,review_id,user_id,reason) VALUES (?,?,?,?)',[crypto.randomUUID(),r.id,req.user.id,reason]);res.json({ok:true})});

const upload=multer({storage:multer.diskStorage({destination:(_r,_f,cb)=>{fs.mkdirSync(path.join(ROOT,'uploads'),{recursive:true});cb(null,path.join(ROOT,'uploads'))},filename:(_r,f,cb)=>cb(null,crypto.randomUUID()+path.extname(f.originalname).toLowerCase())}),limits:{fileSize:5*1024*1024},fileFilter:(_r,f,cb)=>cb(null,['image/png','image/jpeg','image/webp','image/gif'].includes(f.mimetype))});
async function verifyImageFile(file){
  const b=fs.readFileSync(file.path);
  const ok=(file.mimetype==='image/png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (file.mimetype==='image/jpeg'&&b.subarray(0,3).equals(Buffer.from([255,216,255]))) ||
    (file.mimetype==='image/gif'&&(b.subarray(0,6).toString()==='GIF87a'||b.subarray(0,6).toString()==='GIF89a')) ||
    (file.mimetype==='image/webp'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP');
  return ok;
}
app.post('/api/images/upload',requireAuth,upload.single('image'),async(req,res)=>{
  if(!req.file)return send(res,422,'INVALID_IMAGE');
  if(!(await verifyImageFile(req.file))){try{fs.unlinkSync(req.file.path)}catch{};return send(res,422,'INVALID_IMAGE_CONTENT')}
  const id=crypto.randomUUID();
  await db.run('INSERT INTO images (id,owner_id,filename,mime_type,size,path) VALUES (?,?,?,?,?,?)',[id,req.user.id,req.file.filename,req.file.mimetype,req.file.size,'/uploads/'+req.file.filename]);
  res.status(201).json({id,url:'/uploads/'+req.file.filename,mime_type:req.file.mimetype,size:req.file.size});
});
app.post('/api/admin/images/upload',requireAdmin,upload.single('image'),async(req,res)=>{
  if(!req.file)return send(res,422,'INVALID_IMAGE');
  if(!(await verifyImageFile(req.file))){try{fs.unlinkSync(req.file.path)}catch{};return send(res,422,'INVALID_IMAGE_CONTENT')}
  const id=crypto.randomUUID();
  await db.run('INSERT INTO images (id,owner_id,filename,mime_type,size,path) VALUES (?,?,?,?,?,?)',[id,req.user.id,req.file.filename,req.file.mimetype,req.file.size,'/uploads/'+req.file.filename]);
  await audit(req.user.id,'UPLOAD_IMAGE','image',id,{mime:req.file.mimetype,size:req.file.size});
  res.status(201).json({id,url:'/uploads/'+req.file.filename,mime_type:req.file.mimetype,size:req.file.size});
});
app.get('/api/admin/images',requireAdmin,async(req,res)=>{const q=clean(req.query.q,100).trim();const rows=await db.all('SELECT i.*,u.username owner_username FROM images i LEFT JOIN users u ON u.id=i.owner_id WHERE i.filename LIKE ? ORDER BY i.created_at DESC LIMIT 300',['%'+q+'%']);res.json(rows)});
app.delete('/api/admin/images/:id',requireAdmin,async(req,res)=>{const x=await db.get('SELECT * FROM images WHERE id=?',[req.params.id]);if(!x)return send(res,404,'NOT_FOUND');const rel=String(x.path||'').replace(/^\/?/,'').replace(/^uploads[\/]/,'');const file=path.join(ROOT,'uploads',path.basename(rel));try{if(file.startsWith(path.join(ROOT,'uploads'))&&fs.existsSync(file))fs.unlinkSync(file)}catch{};await db.run('DELETE FROM images WHERE id=?',[req.params.id]);await audit(req.user.id,'DELETE_IMAGE','image',req.params.id);res.json({ok:true})});

app.get('/api/admin/dashboard',requireAdmin,async(req,res)=>{const tables=['users','games','packs','news','tutorials','orders','tickets','reviews','notifications'];const out={};for(const t of tables){const r=await db.get(`SELECT COUNT(*) count FROM ${t}`);out[t]=Number(r.count)}out.open_tickets=Number((await db.get("SELECT COUNT(*) count FROM tickets WHERE status NOT IN ('resolved','closed')")).count);out.pending_reviews=Number((await db.get("SELECT COUNT(*) count FROM reviews WHERE status='pending'")).count);res.json(out)});
app.post('/api/admin/login',loginLimiter,async(req,res)=>{const u=await db.get('SELECT * FROM users WHERE username=? AND role=\'admin\'',[clean(req.body?.username,50)]);if(!u||!(await bcrypt.compare(String(req.body?.password||''),u.password_hash)))return send(res,401,'INVALID_LOGIN');const t=random();await db.run('INSERT INTO sessions (id,user_id,expires_at) VALUES (?,?,?)',[hashToken(t),u.id,new Date(Date.now()+1000*60*60*8).toISOString()]);await audit(u.id,'LOGIN_ADMIN','user',u.id);res.json({ok:true,token:t,user:{id:u.id,username:u.username,role:'admin'}})});
app.get('/api/admin/users',requireAdmin,async(req,res)=>{const q=clean(req.query.q,100);res.json(await db.all('SELECT id,username,email,role,status,avatar_url,created_at FROM users WHERE username LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 100',['%'+q+'%','%'+q+'%']))});
app.patch('/api/admin/users/:id',requireAdmin,async(req,res)=>{const status=['active','blocked'].includes(req.body?.status)?req.body.status:null;const role=['user','admin'].includes(req.body?.role)?req.body.role:null;if(!status&&!role)return send(res,422,'INVALID_CHANGE');await db.run('UPDATE users SET status=COALESCE(?,status),role=COALESCE(?,role),updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,role,req.params.id]);await audit(req.user.id,'UPDATE_USER','user',req.params.id,{status,role});res.json({ok:true})});
app.get('/api/admin/orders',requireAdmin,async(req,res)=>res.json(await db.all('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200')));
app.patch('/api/admin/orders/:id',requireAdmin,async(req,res)=>{const s=req.body?.status;if(!['pending','paid','rejected','cancelled','completed'].includes(s))return send(res,422,'INVALID_STATUS');await db.run('UPDATE orders SET status=?,approved_at=CASE WHEN ? IN (\'paid\',\'completed\') THEN CURRENT_TIMESTAMP ELSE approved_at END,approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[s,s,req.user.id,req.params.id]);const o=await db.get('SELECT user_id FROM orders WHERE id=?',[req.params.id]);if(o?.user_id)await notify(o.user_id,'order','وضعیت سفارش تغییر کرد',`سفارش شما اکنون ${s} است.`);await audit(req.user.id,'UPDATE_ORDER','order',req.params.id,{status:s});res.json({ok:true})});
app.get('/api/admin/tickets',requireAdmin,async(req,res)=>res.json(await db.all('SELECT t.*,u.username FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 200')));
app.get('/api/admin/broken-links',requireAdmin,async(req,res)=>res.json(await db.all('SELECT b.*,u.username,g.name game_name,p.name pack_name FROM broken_links b LEFT JOIN users u ON u.id=b.user_id LEFT JOIN games g ON g.id=b.game_id LEFT JOIN packs p ON p.id=b.pack_id ORDER BY b.created_at DESC LIMIT 500')));
app.patch('/api/admin/broken-links/:id',requireAdmin,async(req,res)=>{const status=['open','investigating','fixed','rejected','closed'].includes(req.body?.status)?req.body.status:null;if(!status)return send(res,422,'INVALID_STATUS');const note=clean(req.body?.admin_note,3000);const x=await db.get('SELECT * FROM broken_links WHERE id=?',[req.params.id]);if(!x)return send(res,404,'NOT_FOUND');await db.run('UPDATE broken_links SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[status,note||null,req.params.id]);if(x.user_id)await notify(x.user_id,'support','به‌روزرسانی گزارش لینک','وضعیت گزارش لینک شما تغییر کرد.');await audit(req.user.id,'UPDATE_BROKEN_LINK','broken_link',req.params.id,{status});res.json({ok:true})});
app.get('/api/admin/tickets/:id',requireAdmin,async(req,res)=>{const t=await db.get('SELECT t.*,u.username FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=?',[req.params.id]);if(!t)return send(res,404,'NOT_FOUND');t.messages=await db.all('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY created_at',[t.id]);res.json(t)});
app.post('/api/admin/tickets/:id/messages',requireAdmin,async(req,res)=>{const m=clean(req.body?.message,5000);if(!m)return send(res,422,'MESSAGE_REQUIRED');const t=await db.get('SELECT * FROM tickets WHERE id=?',[req.params.id]);if(!t)return send(res,404,'NOT_FOUND');await db.run('INSERT INTO ticket_messages (id,ticket_id,user_id,is_admin,message) VALUES (?,?,?,?,?)',[crypto.randomUUID(),t.id,req.user.id,1,m]);await db.run("UPDATE tickets SET status='answered',updated_at=CURRENT_TIMESTAMP WHERE id=?",[t.id]);await notify(t.user_id,'support','پاسخ پشتیبانی','مدیریت به گزارش شما پاسخ داد.');await audit(req.user.id,'REPLY_TICKET','ticket',t.id);res.json({ok:true})});
app.patch('/api/admin/tickets/:id',requireAdmin,async(req,res)=>{const s=['new','investigating','answered','resolved','closed'].includes(req.body?.status)?req.body.status:null;if(!s)return send(res,422,'INVALID_STATUS');await db.run('UPDATE tickets SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[s,req.params.id]);await audit(req.user.id,'UPDATE_TICKET','ticket',req.params.id,{status:s});res.json({ok:true})});
app.get('/api/admin/reviews',requireAdmin,async(req,res)=>res.json({games:await db.all('SELECT r.*,u.username,g.name game_name FROM reviews r JOIN users u ON u.id=r.user_id JOIN games g ON g.id=r.game_id ORDER BY r.created_at DESC LIMIT 200'),packs:await db.all('SELECT r.*,u.username,p.name pack_name FROM pack_reviews r JOIN users u ON u.id=r.user_id JOIN packs p ON p.id=r.pack_id ORDER BY r.created_at DESC LIMIT 200')}));
app.patch('/api/admin/reviews/:id',requireAdmin,async(req,res)=>{const s=['pending','approved','rejected'].includes(req.body?.status)?req.body.status:null;if(!s)return send(res,422,'INVALID_STATUS');const r=await db.get('SELECT id,user_id FROM reviews WHERE id=?',[req.params.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run('UPDATE reviews SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[s,req.params.id]);if(s==='approved')await notify(r.user_id,'content','نظر شما تأیید شد','نظر شما با موفقیت منتشر شد.');await audit(req.user.id,'UPDATE_REVIEW','review',req.params.id,{status:s});res.json({ok:true})});
app.delete('/api/admin/reviews/:id',requireAdmin,async(req,res)=>{await db.run('DELETE FROM review_reports WHERE review_id=?',[req.params.id]);await db.run('DELETE FROM reviews WHERE id=?',[req.params.id]);await audit(req.user.id,'DELETE_REVIEW','review',req.params.id);res.json({ok:true})});
app.patch('/api/admin/pack-reviews/:id',requireAdmin,async(req,res)=>{const s=['pending','approved','rejected'].includes(req.body?.status)?req.body.status:null;if(!s)return send(res,422,'INVALID_STATUS');const r=await db.get('SELECT id,user_id FROM pack_reviews WHERE id=?',[req.params.id]);if(!r)return send(res,404,'NOT_FOUND');await db.run('UPDATE pack_reviews SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[s,req.params.id]);if(s==='approved')await notify(r.user_id,'content','نظر شما تأیید شد','نظر شما درباره پک با موفقیت منتشر شد.');await audit(req.user.id,'UPDATE_PACK_REVIEW','pack_review',req.params.id,{status:s});res.json({ok:true})});
app.delete('/api/admin/pack-reviews/:id',requireAdmin,async(req,res)=>{await db.run('DELETE FROM pack_review_reports WHERE review_id=?',[req.params.id]);await db.run('DELETE FROM pack_reviews WHERE id=?',[req.params.id]);await audit(req.user.id,'DELETE_PACK_REVIEW','pack_review',req.params.id);res.json({ok:true})});

const contentAllowed={games:['id','name','short_description','description','img','platform','console','genre','year','version','tags','pack','link','status'],packs:['id','name','short','description','img','price','old_price','status','link'],news:['id','title','summary','content','img','published_at','status'],tutorials:['id','title','content','category','img','published_at','status']};
const contentIdPrefix={games:'G',packs:'P',news:'N',tutorials:'T'};
app.get('/api/admin/content/:type',requireAdmin,async(req,res)=>{const t=tableFor(req.params.type);if(!t)return send(res,404,'UNKNOWN_CONTENT_TYPE');const order=req.params.type==='news'||req.params.type==='tutorials'?'COALESCE(published_at,created_at) DESC, created_at DESC':'created_at DESC';let rows=await db.all(`SELECT * FROM ${t} ORDER BY ${order}`);if(req.params.type==='games')rows=await Promise.all(rows.map(async g=>({...g,pack:g.pack||(await db.get('SELECT pack_id FROM pack_games WHERE game_id=? ORDER BY pack_id LIMIT 1',[g.id]))?.pack_id||null})));res.json(rows)});
app.post('/api/admin/content/:type',requireAdmin,async(req,res)=>{
  const type=req.params.type,t=tableFor(type);if(!t)return send(res,404,'UNKNOWN_CONTENT_TYPE');
  const b={...(req.body||{})};
  if(b.desc!==undefined&&b.description===undefined)b.description=b.desc;
  if(b.old!==undefined&&b.old_price===undefined)b.old_price=Number(String(b.old).replace(/[^0-9]/g,''))||0;
  const titleField=(type==='games'||type==='packs')?'name':'title';
  const title=clean(b[titleField]||b.name||b.title,300).trim();
  if(!title)return send(res,422,'NAME_REQUIRED');
  const suppliedId=clean(b.id,120).trim();
  const columns=contentAllowed[type].filter(k=>k!=='id'&&b[k]!==undefined);
  if(type==='games'&&b.pack_id!==undefined&&b.pack===undefined)b.pack=b.pack_id;
  const finalColumns=contentAllowed[type].filter(k=>k!=='id'&&b[k]!==undefined);
  let id,item,created=false;
  if(suppliedId){
    const existing=await db.get(`SELECT id FROM ${t} WHERE id=?`,[suppliedId]);
    if(!existing)return send(res,404,'CONTENT_NOT_FOUND');
    const updateCols=finalColumns.filter(k=>k!=='id');
    if(!updateCols.length)return send(res,422,'NO_FIELDS_TO_UPDATE');
    await db.run(`UPDATE ${t} SET ${updateCols.map(k=>`${k}=?`).join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`,[...updateCols.map(k=>b[k]),suppliedId]);
    id=suppliedId;
  }else{
    id=`${contentIdPrefix[type]}-${crypto.randomUUID()}`;
    const insertCols=['id',...finalColumns];
    const vals=[id,...finalColumns.map(k=>b[k])];
    await db.run(`INSERT INTO ${t} (${insertCols.join(',')}) VALUES (${insertCols.map(()=>'?').join(',')})`,vals);
    created=true;
  }
  if(type==='games'&&b.pack!==undefined){
    const packId=String(b.pack||'').trim()||null;
    await db.run('DELETE FROM pack_games WHERE game_id=?',[id]);
    await db.run('UPDATE games SET pack=? WHERE id=?',[packId,id]);
    if(packId)await db.run('INSERT INTO pack_games (pack_id,game_id) VALUES (?,?) ON CONFLICT DO NOTHING',[packId,id]);
  }
  item=await db.get(`SELECT * FROM ${t} WHERE id=?`,[id]);
  await audit(req.user.id,created?'CREATE_CONTENT':'UPDATE_CONTENT',type,id,{title});
  if(created&&item.status==='published')await notifyAll(type==='games'?'game':type==='packs'?'pack':type==='news'?'news':'tutorial','محتوای جدید منتشر شد',`${title} منتشر شد.`).catch(()=>{});
  res.status(created?201:200).json({ok:true,created,id,item});
});
app.delete('/api/admin/content/:type/:id',requireAdmin,async(req,res)=>{const t=tableFor(req.params.type);if(!t)return send(res,404,'UNKNOWN_CONTENT_TYPE');await db.run(`DELETE FROM ${t} WHERE id=?`,[req.params.id]);await audit(req.user.id,'DELETE_CONTENT',req.params.type,req.params.id);res.json({ok:true})});
app.post('/api/admin/packs/:id/games',requireAdmin,async(req,res)=>{
  const packId=req.params.id;if(!await db.get('SELECT id FROM packs WHERE id=?',[packId]))return send(res,404,'PACK_NOT_FOUND');
  const requested=Array.isArray(req.body?.game_ids)?req.body.game_ids.map(x=>clean(x,120)).filter(Boolean):[];
  const ids=[];for(const gid of requested){if(await db.get('SELECT id FROM games WHERE id=?',[gid]))ids.push(gid)}
  await db.transaction(async tx=>{
    const previous=await tx.all('SELECT game_id FROM pack_games WHERE pack_id=?',[packId]);
    await tx.run('DELETE FROM pack_games WHERE pack_id=?',[packId]);
    for(const row of previous){if(!ids.includes(row.game_id))await tx.run('UPDATE games SET pack=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND pack=?',[row.game_id,packId])}
    for(const gid of ids){await tx.run('DELETE FROM pack_games WHERE game_id=?',[gid]);await tx.run('INSERT INTO pack_games (pack_id,game_id) VALUES (?,?) ON CONFLICT DO NOTHING',[packId,gid]);await tx.run('UPDATE games SET pack=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[packId,gid])}
  });
  await audit(req.user.id,'SET_PACK_GAMES','pack',packId,{count:ids.length});res.json({ok:true,count:ids.length});
});
app.get('/api/admin/audit',requireAdmin,async(req,res)=>res.json(await db.all('SELECT a.*,u.username FROM audit_logs a LEFT JOIN users u ON u.id=a.admin_user_id ORDER BY a.created_at DESC LIMIT 500')));
app.get('/api/admin/status',requireAdmin,async(req,res)=>res.json(await db.all('SELECT * FROM site_status ORDER BY key')));
app.patch('/api/admin/status/:key',requireAdmin,async(req,res)=>{const status=['operational','degraded','maintenance','down'].includes(req.body?.status)?req.body.status:null;if(!status)return send(res,422,'INVALID_STATUS');await db.run('INSERT INTO site_status (key,status,message) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET status=EXCLUDED.status,message=EXCLUDED.message,updated_at=CURRENT_TIMESTAMP',[req.params.key,status,clean(req.body?.message,500)]);await audit(req.user.id,'UPDATE_STATUS','site_status',req.params.key,{status});res.json({ok:true})});

app.use((err,req,res,next)=>{console.error(err);if(err instanceof multer.MulterError)return send(res,400,'UPLOAD_ERROR');if(res.headersSent)return next(err);send(res,500,'INTERNAL_ERROR')});
app.use((req,res)=>send(res,404,'NOT_FOUND'));
app.listen(PORT,()=>console.log(`GAME TROLL API running on port ${PORT}`));
