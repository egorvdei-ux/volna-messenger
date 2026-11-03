import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';

const derive = promisify(scrypt);
const here = dirname(fileURLToPath(import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
class Failure extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new Failure(status, message); };
const userView = u => ({ id: u.id, username: u.username, name: u.name });

export function createMessenger({ database = join(here, 'data', 'volna.sqlite') } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      salt TEXT NOT NULL, password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, a TEXT NOT NULL REFERENCES users(id), b TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL, UNIQUE(a,b)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id),
      sender_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL,
      created_at INTEGER NOT NULL, client_id TEXT NOT NULL,
      UNIQUE(sender_id,client_id)
    );
    CREATE INDEX IF NOT EXISTS message_chat ON messages(chat_id,id);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
  `);
  const query = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const limits = new Map();
  function rate(key, maximum, windowMs) {
    const now = Date.now();
    let record = limits.get(key);
    if (!record || record.until <= now) { record = { count: 0, until: now + windowMs }; limits.set(key, record); }
    if (++record.count > maximum) fail(429, 'Слишком много запросов. Попробуйте позже.');
  }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
    run('DELETE FROM sessions WHERE expires <= ?', now);
  }, 60_000);
  cleanup.unref();
  function auth(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const user = token && query(`SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token=? AND s.expires>?`, digest(token), Date.now());
    if (!user) fail(401, 'Войдите в аккаунт заново.');
    return user;
  }
  function member(id, user) {
    const chat = query('SELECT * FROM chats WHERE id=? AND (a=? OR b=?)', id, user.id, user.id);
    if (!chat) fail(404, 'Чат не найден.');
    return chat;
  }
  async function body(req) {
    if (!String(req.headers['content-type']).startsWith('application/json')) fail(415, 'Нужен формат JSON.');
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) fail(413, 'Запрос слишком большой.');
      chunks.push(chunk);
    }
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Некорректный JSON.'); }
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Некорректный запрос.');
    return data;
  }
  function text(data, key, min, max) {
    const value = typeof data[key] === 'string' ? data[key].trim() : '';
    if ([...value].length < min || [...value].length > max) fail(400, `Поле «${key}»: от ${min} до ${max} символов.`);
    return value;
  }
  function session(user) {
    const token = randomBytes(32).toString('base64url');
    run('INSERT INTO sessions VALUES (?,?,?)', digest(token), user.id, Date.now() + 30*86400_000);
    return { token, user: userView(user) };
  }
  function chatView(chat, user) {
    return {
      id: chat.id,
      peer: userView(query('SELECT * FROM users WHERE id=?', chat.a === user.id ? chat.b : chat.a)),
      lastMessage: query('SELECT * FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 1', chat.id) || null,
      created_at: chat.created_at
    };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const method = req.method;
      rate(`requests:${req.socket.remoteAddress}`, 900, 60_000);
      if (method === 'GET' && path === '/health') return send(200, { ok: true, app: 'Volna', version: '0.1.0' });
      const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/style.css': ['style.css','text/css'] };
      if (method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
        return res.end(readFileSync(join(here, 'public', file)));
      }
      if (method === 'POST' && ['/api/register','/api/login'].includes(path)) {
        rate(`login:${req.socket.remoteAddress}`, 30, 600_000);
        const data = await body(req);
        const username = text(data, 'username', 3, 24).toLowerCase();
        if (!/^[a-z0-9_]{3,24}$/.test(username)) fail(400, 'Имя пользователя: латинские буквы, цифры, _; 3–24 символа.');
        const password = typeof data.password === 'string' ? data.password : '';
        if (password.length < 8 || password.length > 200) fail(400, 'Пароль: от 8 до 200 символов.');
        if (path === '/api/register') {
          const name = text(data, 'name', 1, 40);
          const salt = randomBytes(16).toString('hex');
          const hash = (await derive(password, salt, 64)).toString('hex');
          if (query('SELECT id FROM users WHERE username=?', username)) fail(409, 'Это имя пользователя уже занято.');
          const user = { id: randomUUID(), username, name };
          run('INSERT INTO users VALUES (?,?,?,?,?)', user.id, username, name, salt, hash);
          return send(201, session(user));
        }
        const user = query('SELECT * FROM users WHERE username=?', username);
        const hash = await derive(password, user?.salt || 'volna-missing-user-salt', 64);
        if (!user || !timingSafeEqual(hash, Buffer.from(user.password, 'hex'))) fail(401, 'Неверное имя пользователя или пароль.');
        return send(200, session(user));
      }
      if (!path.startsWith('/api/')) fail(404, 'Не найдено.');
      const user = auth(req);
      if (method === 'GET' && path === '/api/me') return send(200, userView(user));
      if (method === 'POST' && path === '/api/logout') {
        run('DELETE FROM sessions WHERE token=?', digest(req.headers.authorization.slice(7)));
        return send(200, { ok: true });
      }
      if (method === 'GET' && path === '/api/chats') {
        const chats = all('SELECT * FROM chats WHERE a=? OR b=?', user.id, user.id).map(c => chatView(c, user));
        chats.sort((a,b) => (b.lastMessage?.created_at || b.created_at) - (a.lastMessage?.created_at || a.created_at));
        return send(200, chats);
      }
      if (method === 'POST' && path === '/api/chats') {
        rate(`chats:${user.id}`, 30, 60_000);
        const data = await body(req);
        const username = text(data, 'username', 3, 24).replace(/^@/, '').toLowerCase();
        const peer = query('SELECT * FROM users WHERE username=?', username);
        if (!peer) fail(404, 'Пользователь не найден. Попросите его зарегистрироваться.');
        if (peer.id === user.id) fail(400, 'Укажите имя другого пользователя.');
        const [a,b] = [user.id,peer.id].sort();
        run('INSERT OR IGNORE INTO chats VALUES (?,?,?,?)', randomUUID(), a, b, Date.now());
        return send(200, chatView(query('SELECT * FROM chats WHERE a=? AND b=?', a,b), user));
      }
      const match = path.match(/^\/api\/chats\/([0-9a-f-]{36})\/messages$/);
      if (match) {
        const chat = member(match[1], user);
        if (method === 'GET') {
          const cursor = key => {
            const raw = url.searchParams.get(key);
            if (raw === null) return null;
            if (!/^\d{1,15}$/.test(raw)) fail(400, 'Неверный указатель истории.');
            return Number(raw);
          };
          const after = cursor('after'); const before = cursor('before');
          if (after !== null && before !== null) fail(400, 'Укажите один указатель истории.');
          if (after !== null) return send(200, all('SELECT * FROM messages WHERE chat_id=? AND id>? ORDER BY id LIMIT 100', chat.id, after));
          const rows = before !== null
            ? all('SELECT * FROM messages WHERE chat_id=? AND id<? ORDER BY id DESC LIMIT 100', chat.id,before)
            : all('SELECT * FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 100', chat.id);
          return send(200, rows.reverse());
        }
        if (method === 'POST') {
          rate(`send:${user.id}`, 120, 60_000);
          const data = await body(req);
          const message = text(data, 'text', 1, 4000);
          const clientID = text(data, 'client_id', 8, 80);
          const existing = query('SELECT * FROM messages WHERE sender_id=? AND client_id=?', user.id, clientID);
          if (existing) {
            if (existing.chat_id !== chat.id || existing.text !== message) fail(409, 'Идентификатор сообщения уже использован.');
            return send(200, existing);
          }
          const result = run('INSERT INTO messages (chat_id,sender_id,text,created_at,client_id) VALUES (?,?,?,?,?)', chat.id,user.id,message,Date.now(),clientID);
          return send(201, query('SELECT * FROM messages WHERE id=?', Number(result.lastInsertRowid)));
        }
      }
      fail(404, 'Не найдено.');
    } catch (error) {
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте ещё раз.' });
      if (!error.status) console.error('Request failed:', error.code || error.name);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('close', () => { clearInterval(cleanup); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMessenger({ database: process.env.VOLNA_DATABASE || undefined });
  const port = Number(process.env.PORT || 8787);
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`Volna: http://localhost:${port}`);
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)) console.log(`LAN: http://${entry.address}:${port}`);
    }
    console.log('Keep this window open. iPhone and PC must use the same Wi-Fi.');
  });
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { server.close(); server.closeIdleConnections(); });
}
