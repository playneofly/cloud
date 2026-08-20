/* ─────────────────────────────────────────────────────────────
   پیام‌رسان T — میدل‌ور Cloudflare Pages Functions
   بک‌اند API زیرِ /api/* با دیتابیس D1 (Binding: DB — Database: t)
   ───────────────────────────────────────────────────────────── */

const JSON_H = { "content-type": "application/json; charset=utf-8" };
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_H, ...headers } });

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;

async function sha256hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", typeof buf === "string" ? enc.encode(buf) : buf);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const PB_ITER = 120000;
async function hashPass(pass, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16)).buffer;
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PB_ITER }, key, 256);
  return `pbkdf2$${PB_ITER}$${b64(salt)}$${b64(bits)}`;
}
async function verifyPass(pass, stored) {
  try {
    const [kind, iter, salt, hash] = String(stored).split("$");
    if (kind !== "pbkdf2") return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: +iter }, key, 256);
    return b64(bits) === hash;
  } catch {
    return false;
  }
}

/* ساخت جداول در اولین اجرا */
let migrated = false;
async function migrate(DB) {
  if (migrated) return;
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      pass TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT 'gold',
      verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS chats(
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      avatar TEXT NOT NULL DEFAULT 'gold', created_by TEXT, created_at INTEGER NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS chat_members(
      chat_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read INTEGER NOT NULL DEFAULT 0,
      UNIQUE(chat_id, user_id))`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS messages(
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_id TEXT NOT NULL,
      text TEXT NOT NULL, reply_to TEXT, fwd_from TEXT, created_at INTEGER NOT NULL)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS reactions(
      message_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'heart',
      UNIQUE(message_id, user_id, kind))`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ix_msgs_chat ON messages(chat_id, created_at)`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS ix_members_user ON chat_members(user_id)`),
  ]);
  migrated = true;
}

const cookieOf = (req, name) => {
  const c = req.headers.get("Cookie") || "";
  const m = c.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
};

async function currentUser(DB, req) {
  const token = cookieOf(req, "t_session");
  if (!token) return null;
  const th = await sha256hex(token);
  const row = await DB.prepare(
    `SELECT u.id,u.username,u.name,u.avatar,u.verified FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(th, Date.now()).first();
  return row || null;
}

async function newSession(DB, userId) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const th = await sha256hex(token);
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  await DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`).bind(th, userId, exp).run();
  return `t_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}

const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar, verified: !!u.verified });

async function isMember(DB, chatId, userId) {
  return !!(await DB.prepare(`SELECT 1 FROM chat_members WHERE chat_id=? AND user_id=?`).bind(chatId, userId).first());
}

async function chatJson(DB, chat, meId) {
  const out = { id: chat.id, kind: chat.kind, title: chat.title, avatar: chat.avatar };
  if (chat.kind === "direct") {
    const peer = await DB.prepare(
      `SELECT u.id,u.username,u.name,u.avatar,u.verified FROM chat_members m
       JOIN users u ON u.id=m.user_id WHERE m.chat_id=? AND m.user_id!=?`
    ).bind(chat.id, meId).first();
    if (peer) {
      out.peer = publicUser(peer);
      if (!out.title) out.title = peer.name;
      if (chat.avatar === "gold") out.avatar = peer.avatar;
      out.online = false;
    }
  }
  const last = await DB.prepare(
    `SELECT text,created_at FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT 1`
  ).bind(chat.id).first();
  if (last) { out.lastText = last.text; out.lastAt = last.created_at; }
  const mem = await DB.prepare(`SELECT last_read FROM chat_members WHERE chat_id=? AND user_id=?`).bind(chat.id, meId).first();
  const lr = mem ? mem.last_read : 0;
  const un = await DB.prepare(
    `SELECT COUNT(*) n FROM messages WHERE chat_id=? AND created_at>? AND sender_id!=?`
  ).bind(chat.id, lr, meId).first();
  out.unread = un ? un.n : 0;
  return out;
}

async function route(req, env, url) {
  const DB = env.DB;
  const path = url.pathname;
  const method = req.method;
  const me = await currentUser(DB, req);
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  /* ── ثبت‌نام ── */
  if (path === "/api/signup" && method === "POST") {
    const b = await body();
    const username = String(b.username || "").trim();
    const name = String(b.name || "").trim() || username;
    const avatar = String(b.avatar || "gold");
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return json({ error: "نام کاربری باید ۳ تا ۲۴ حرف انگلیسی/عدد باشد" }, 400);
    if (String(b.password || "").length < 4) return json({ error: "رمز عبور باید حداقل ۴ کاراکتر باشد" }, 400);
    const id = crypto.randomUUID();
    try {
      await DB.prepare(`INSERT INTO users(id,username,pass,name,avatar,verified,created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(id, username, await hashPass(String(b.password)), name, avatar, username.toLowerCase() === "support" ? 1 : 0, Date.now()).run();
    } catch {
      return json({ error: "این نام کاربری قبلاً گرفته شده است" }, 409);
    }
    // چت «پیام‌های ذخیره‌شده» برای هر کاربر جدید
    const sc = crypto.randomUUID();
    await DB.prepare(`INSERT INTO chats(id,kind,title,avatar,created_by,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(sc, "saved", "پیام‌های ذخیره‌شده", "gold", id, Date.now()).run();
    await DB.prepare(`INSERT INTO chat_members(chat_id,user_id,last_read) VALUES(?,?,0)`).bind(sc, id).run();
    const setCookie = await newSession(DB, id);
    return json({ user: publicUser({ id, username, name, avatar, verified: username.toLowerCase() === "support" ? 1 : 0 }) }, 200, { "Set-Cookie": setCookie });
  }

  /* ── ورود ── */
  if (path === "/api/login" && method === "POST") {
    const b = await body();
    const u = await DB.prepare(`SELECT * FROM users WHERE username=?`).bind(String(b.username || "").trim()).first();
    if (!u || !(await verifyPass(String(b.password || ""), u.pass)))
      return json({ error: "نام کاربری یا رمز عبور اشتباه است" }, 401);
    const setCookie = await newSession(DB, u.id);
    return json({ user: publicUser(u) }, 200, { "Set-Cookie": setCookie });
  }

  /* ── خروج ── */
  if (path === "/api/logout" && method === "POST") {
    const token = cookieOf(req, "t_session");
    if (token) await DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(await sha256hex(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": "t_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
  }

  /* ── من ── */
  if (path === "/api/me" && method === "GET") {
    if (!me) return json({ error: "unauthorized" }, 401);
    return json({ user: publicUser(me) });
  }

  /* از اینجا به بعد نیاز به ورود دارد */
  if (!me) return json({ error: "unauthorized" }, 401);

  /* ── جستجوی کاربران ── */
  if (path === "/api/users/search" && method === "GET") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (q.length < 2) return json({ users: [] });
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const rows = await DB.prepare(
      `SELECT id,username,name,avatar,verified FROM users
       WHERE (username LIKE ? OR name LIKE ?) AND id!=? LIMIT 12`
    ).bind(like, like, me.id).all();
    return json({ users: (rows.results || []).map(publicUser) });
  }

  /* ── فهرست گفتگوها ── */
  if (path === "/api/chats" && method === "GET") {
    const rows = await DB.prepare(
      `SELECT c.* FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.user_id=?`
    ).bind(me.id).all();
    const chats = [];
    for (const c of rows.results || []) chats.push(await chatJson(DB, c, me.id));
    chats.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
    return json({ chats });
  }

  /* ── ساخت گفتگو ── */
  if (path === "/api/chats" && method === "POST") {
    const b = await body();
    const kind = String(b.kind || "direct");
    if (kind === "direct") {
      const target = String(b.username || "").replace(/^@/, "").trim();
      const u = await DB.prepare(`SELECT * FROM users WHERE username=?`).bind(target).first();
      if (!u) return json({ error: "کاربری با این نام پیدا نشد" }, 404);
      if (u.id === me.id) return json({ error: "برای خودتان «پیام‌های ذخیره‌شده» را دارید" }, 400);
      const mine = await DB.prepare(
        `SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id=c.id
         WHERE c.kind='direct' AND m.user_id=?`
      ).bind(me.id).all();
      for (const c of mine.results || []) {
        if (await isMember(DB, c.id, u.id)) {
          const full = await DB.prepare(`SELECT * FROM chats WHERE id=?`).bind(c.id).first();
          return json({ chat: await chatJson(DB, full, me.id) });
        }
      }
      const cid = crypto.randomUUID();
      await DB.batch([
        DB.prepare(`INSERT INTO chats(id,kind,title,avatar,created_by,created_at) VALUES(?,?,?,?,?,?)`).bind(cid, "direct", "", "gold", me.id, Date.now()),
        DB.prepare(`INSERT INTO chat_members(chat_id,user_id,last_read) VALUES(?,?,0)`).bind(cid, me.id),
        DB.prepare(`INSERT INTO chat_members(chat_id,user_id,last_read) VALUES(?,?,0)`).bind(cid, u.id),
      ]);
      const full = await DB.prepare(`SELECT * FROM chats WHERE id=?`).bind(cid).first();
      return json({ chat: await chatJson(DB, full, me.id) });
    }
    if (kind === "group" || kind === "channel" || kind === "saved") {
      const title = kind === "saved" ? "پیام‌های ذخیره‌شده" : String(b.title || "").trim();
      if (!title) return json({ error: "عنوان لازم است" }, 400);
      const cid = crypto.randomUUID();
      await DB.prepare(`INSERT INTO chats(id,kind,title,avatar,created_by,created_at) VALUES(?,?,?,?,?,?)`)
        .bind(cid, kind, title, kind === "channel" ? "teal" : kind === "saved" ? "gold" : "green", me.id, Date.now()).run();
      await DB.prepare(`INSERT INTO chat_members(chat_id,user_id,last_read) VALUES(?,?,0)`).bind(cid, me.id).run();
      await DB.prepare(`INSERT INTO messages(id,chat_id,sender_id,text,created_at) VALUES(?,?,?,?,?)`)
        .bind(crypto.randomUUID(), cid, "system", `${kind === "channel" ? "کانال" : kind === "group" ? "گروه" : "«پیام‌های ذخیره‌شده»"} «${title}» ساخته شد`, Date.now()).run();
      const full = await DB.prepare(`SELECT * FROM chats WHERE id=?`).bind(cid).first();
      return json({ chat: await chatJson(DB, full, me.id) });
    }
    return json({ error: "نوع گفتگو نامعتبر است" }, 400);
  }

  /* ── پیام‌های یک گفتگو ── */
  let m = path.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (m && method === "GET") {
    const chatId = decodeURIComponent(m[1]);
    if (!(await isMember(DB, chatId, me.id))) return json({ error: "دسترسی ندارید" }, 403);
    const rows = await DB.prepare(
      `SELECT * FROM messages WHERE chat_id=? ORDER BY created_at ASC LIMIT 300`
    ).bind(chatId).all();
    const messages = [];
    for (const r of rows.results || []) {
      let replyText = null;
      if (r.reply_to) {
        const rp = await DB.prepare(`SELECT text FROM messages WHERE id=?`).bind(r.reply_to).first();
        replyText = rp ? rp.text.slice(0, 90) : null;
      }
      const hearts = await DB.prepare(`SELECT COUNT(*) n FROM reactions WHERE message_id=? AND kind='heart'`).bind(r.id).first();
      const mine = await DB.prepare(`SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND kind='heart'`).bind(r.id, me.id).first();
      messages.push({
        id: r.id, chatId: r.chat_id, senderId: r.sender_id, text: r.text,
        replyTo: r.reply_to || null, replyText, fwdFrom: r.fwd_from || null,
        createdAt: r.created_at, hearts: hearts ? hearts.n : 0, myHeart: !!mine,
      });
    }
    return json({ messages });
  }

  if (m && method === "POST") {
    const chatId = decodeURIComponent(m[1]);
    if (!(await isMember(DB, chatId, me.id))) return json({ error: "دسترسی ندارید" }, 403);
    const b = await body();
    const text = String(b.text || "").slice(0, 4000).trim();
    if (!text) return json({ error: "پیام خالی است" }, 400);
    const id = crypto.randomUUID();
    const at = Date.now();
    await DB.prepare(`INSERT INTO messages(id,chat_id,sender_id,text,reply_to,fwd_from,created_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, chatId, me.id, text, b.replyTo || null, b.fwdFrom || null, at).run();
    await DB.prepare(`UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?`).bind(at, chatId, me.id).run();
    let replyText = null;
    if (b.replyTo) {
      const rp = await DB.prepare(`SELECT text FROM messages WHERE id=?`).bind(b.replyTo).first();
      replyText = rp ? rp.text.slice(0, 90) : null;
    }
    return json({ message: { id, chatId, senderId: me.id, text, replyTo: b.replyTo || null, replyText, fwdFrom: b.fwdFrom || null, createdAt: at, hearts: 0, myHeart: false } });
  }

  /* ── خوانده شد ── */
  m = path.match(/^\/api\/chats\/([^/]+)\/read$/);
  if (m && method === "POST") {
    const chatId = decodeURIComponent(m[1]);
    await DB.prepare(`UPDATE chat_members SET last_read=? WHERE chat_id=? AND user_id=?`).bind(Date.now(), chatId, me.id).run();
    return json({ ok: true });
  }

  /* ── ری‌اکشن قلب ── */
  m = path.match(/^\/api\/messages\/([^/]+)\/react$/);
  if (m && method === "POST") {
    const mid = decodeURIComponent(m[1]);
    const msg = await DB.prepare(`SELECT chat_id FROM messages WHERE id=?`).bind(mid).first();
    if (!msg || !(await isMember(DB, msg.chat_id, me.id))) return json({ error: "دسترسی ندارید" }, 403);
    const had = await DB.prepare(`SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND kind='heart'`).bind(mid, me.id).first();
    if (had) await DB.prepare(`DELETE FROM reactions WHERE message_id=? AND user_id=? AND kind='heart'`).bind(mid, me.id).run();
    else await DB.prepare(`INSERT OR IGNORE INTO reactions(message_id,user_id,kind) VALUES(?,?,'heart')`).bind(mid, me.id).run();
    return json({ ok: true, on: !had });
  }

  return json({ error: "not-found" }, 404);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith("/api/")) return context.next();
  if (!context.env.DB) return json({ error: "DB binding missing — در تنظیمات Pages بایندینگ D1 را با نام DB و دیتابیس t بسازید" }, 500);
  try {
    await migrate(context.env.DB);
    const res = await route(context.request, context.env, url);
    return res;
  } catch (e) {
    return json({ error: "server-error", detail: String(e && e.message || e) }, 500);
  }
}
