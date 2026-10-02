import pgLib from 'pg';
import Database from 'better-sqlite3';

const { Pool } = pgLib;
const usePostgres = Boolean(process.env.DATABASE_URL);
let sqlite, pool;

const schema = `
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
 avatar_url TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TIMESTAMP NOT NULL, revoked_at TIMESTAMP,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS password_resets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMP NOT NULL,
 used_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_settings (
 user_id TEXT PRIMARY KEY, support_notifications INTEGER NOT NULL DEFAULT 1,
 order_notifications INTEGER NOT NULL DEFAULT 1, content_notifications INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS games (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, short_description TEXT, description TEXT, img TEXT,
 platform TEXT, console TEXT, genre TEXT, year INTEGER, version TEXT, tags TEXT, pack TEXT,
 link TEXT, status TEXT NOT NULL DEFAULT 'published', created_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS packs (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, short TEXT, description TEXT, img TEXT, price INTEGER DEFAULT 0,
 old_price INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'published', link TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pack_games (pack_id TEXT NOT NULL, game_id TEXT NOT NULL, PRIMARY KEY(pack_id,game_id));
CREATE INDEX IF NOT EXISTS idx_pack_games_game ON pack_games(game_id);
CREATE TABLE IF NOT EXISTS news (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, content TEXT, img TEXT, published_at TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'published', created_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news(status,published_at,created_at);
CREATE TABLE IF NOT EXISTS tutorials (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT, category TEXT, img TEXT, published_at TIMESTAMP,
 status TEXT NOT NULL DEFAULT 'published', created_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL, game_id TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,game_id));
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, user_id TEXT, customer_name TEXT, customer_contact TEXT, item_type TEXT NOT NULL, item_id TEXT NOT NULL,
 item_name TEXT, amount INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', receipt TEXT, note TEXT,
 approved_at TIMESTAMP, approved_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tickets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL,
 game_id TEXT, pack_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'investigating', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ticket_messages (id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT, is_admin INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS broken_links (id TEXT PRIMARY KEY, user_id TEXT, game_id TEXT, pack_id TEXT, url TEXT, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', admin_note TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read_at TIMESTAMP, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ratings (user_id TEXT NOT NULL, game_id TEXT NOT NULL, rating INTEGER NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,game_id));
CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, game_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS review_reports (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pack_ratings (user_id TEXT NOT NULL, pack_id TEXT NOT NULL, rating INTEGER NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,pack_id));
CREATE TABLE IF NOT EXISTS pack_reviews (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pack_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pack_review_reports (id TEXT PRIMARY KEY, review_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_pack_reviews_pack ON pack_reviews(pack_id,status);
CREATE INDEX IF NOT EXISTS idx_pack_review_reports_review ON pack_review_reports(review_id);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, admin_user_id TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT, metadata TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_status (key TEXT PRIMARY KEY, status TEXT NOT NULL, message TEXT, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, owner_id TEXT, filename TEXT, mime_type TEXT, size INTEGER, path TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, filename TEXT NOT NULL, path TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_games_search ON games(name,console,platform,genre,year,version,tags,pack);
CREATE INDEX IF NOT EXISTS idx_games_advanced ON games(status,console,platform,genre,year,pack,created_at);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at,owner_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_game ON reviews(game_id,status);
`;

if (usePostgres) {
  pool = new Pool({connectionString:process.env.DATABASE_URL,max:5,ssl:{rejectUnauthorized:false}});
  await pool.query(schema);
  // Compatibility migration from the Phase 1 schema.
  const migrations = [
    'ALTER TABLE games ADD COLUMN IF NOT EXISTS short_description TEXT',
    'ALTER TABLE games ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT \'published\'',
    'ALTER TABLE games ADD COLUMN IF NOT EXISTS tags TEXT',
    'ALTER TABLE games ADD COLUMN IF NOT EXISTS created_by TEXT',
    'ALTER TABLE packs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT \'published\'',
    'ALTER TABLE packs ADD COLUMN IF NOT EXISTS description TEXT',
    'ALTER TABLE packs ADD COLUMN IF NOT EXISTS old_price INTEGER DEFAULT 0',
    'ALTER TABLE news ADD COLUMN IF NOT EXISTS summary TEXT',
    'ALTER TABLE news ADD COLUMN IF NOT EXISTS content TEXT',
    'ALTER TABLE news ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT \'published\'',
    'ALTER TABLE tutorials ADD COLUMN IF NOT EXISTS content TEXT',
    'ALTER TABLE tutorials ADD COLUMN IF NOT EXISTS category TEXT',
    'ALTER TABLE tutorials ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT \'published\''
  ];
  for (const q of migrations) await pool.query(q);
} else {
  sqlite = new Database(process.env.DB_PATH || './game-troll.sqlite');
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(schema.replaceAll('TIMESTAMP','TEXT'));
  const adds = [
    ['games','short_description','TEXT'],['games','short','TEXT'],['games','status',"TEXT NOT NULL DEFAULT 'published'"],['games','tags','TEXT'],['games','created_by','TEXT'],
    ['packs','status',"TEXT NOT NULL DEFAULT 'published'"],['packs','description','TEXT'],['packs','old_price','INTEGER DEFAULT 0'],
    ['news','summary','TEXT'],['news','content','TEXT'],['news','status',"TEXT NOT NULL DEFAULT 'published'"],
    ['tutorials','content','TEXT'],['tutorials','category','TEXT'],['tutorials','status',"TEXT NOT NULL DEFAULT 'published'"]
  ];
  for(const [t,c,d] of adds){try{sqlite.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`)}catch(e){if(!String(e.message).includes('duplicate column'))throw e}}
}

// Normalize legacy ticket statuses. The ticket workflow intentionally has only three states.
if (usePostgres) {
  await pool.query("UPDATE tickets SET status='investigating' WHERE status IN ('new','open','pending','resolved')");
} else {
  sqlite.prepare("UPDATE tickets SET status='investigating' WHERE status IN ('new','open','pending','resolved')").run();
}

// Backfill existing game-to-pack links into the relation table without deleting or changing records.
await (usePostgres ? pool.query("INSERT INTO pack_games (pack_id,game_id) SELECT pack,id FROM games WHERE COALESCE(pack,'')<>'' ON CONFLICT DO NOTHING") : sqlite.prepare("INSERT INTO pack_games (pack_id,game_id) SELECT pack,id FROM games WHERE COALESCE(pack,'')<>'' ON CONFLICT DO NOTHING").run());

function toPg(sql,params){let n=0;return sql.replaceAll('?',()=>`$${++n}`)}
export const db={
 async all(sql,params=[]){if(!usePostgres)return sqlite.prepare(sql).all(...params);return (await pool.query(toPg(sql,params),params)).rows},
 async get(sql,params=[]){if(!usePostgres)return sqlite.prepare(sql).get(...params);return (await pool.query(toPg(sql,params),params)).rows[0]},
 async run(sql,params=[]){if(!usePostgres)return sqlite.prepare(sql).run(...params);return pool.query(toPg(sql,params),params)},
 async upsert(table,columns,values){if(!usePostgres){const ph=columns.map(()=>'?').join(',');const up=columns.filter(c=>c!=='id').map(c=>`${c}=excluded.${c}`).join(',');sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${up}, updated_at=CURRENT_TIMESTAMP`).run(...values);return sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(values[columns.indexOf('id')]);}const ph=columns.map((_,i)=>`$${i+1}`).join(',');const up=columns.filter(c=>c!=='id').map(c=>`${c}=EXCLUDED.${c}`).join(',');return (await pool.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${up}, updated_at=CURRENT_TIMESTAMP RETURNING *`,values)).rows[0]},
 async transaction(fn){if(usePostgres){const c=await pool.connect();try{await c.query('BEGIN');const tx={all:async(s,p=[])=> (await c.query(toPg(s,p),p)).rows,get:async(s,p=[])=> (await c.query(toPg(s,p),p)).rows[0],run:async(s,p=[])=>c.query(toPg(s,p),p)};const r=await fn(tx);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}const tx={all:async(s,p=[])=>sqlite.prepare(s).all(...p),get:async(s,p=[])=>sqlite.prepare(s).get(...p),run:async(s,p=[])=>sqlite.prepare(s).run(...p)};return fn(tx)}
};
