/* لایه API پیام‌رسان T
   - اگر بک‌اند کلادفلر (Pages Functions + D1) در دسترس باشد → حالت زنده
   - در غیر این صورت (پیش‌نمایش محلی) → حالت دمو با localStorage */

export type User = {
  id: string;
  username: string;
  name: string;
  avatar: string;
  verified?: boolean;
};

export type Chat = {
  id: string;
  kind: "direct" | "group" | "channel" | "saved";
  title: string;
  avatar: string;
  peer?: User | null;
  lastText?: string;
  lastAt?: number;
  unread?: number;
  online?: boolean;
  verified?: boolean;
};

export type Message = {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  replyTo?: string | null;
  replyText?: string | null;
  fwdFrom?: string | null;
  createdAt: number;
  hearts?: number;
  myHeart?: boolean;
  seen?: boolean;
};

const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" };

async function tryFetch(input: string, init?: RequestInit): Promise<any> {
  const res = await fetch(input, { ...init, headers: { ...jsonHeaders } });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) throw new Error("no-api");
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || "خطا"), { data });
  return data;
}

/* ─────────── حالت دمو (localStorage) ─────────── */

type DemoDB = {
  users: (User & { pass: string })[];
  chats: (Chat & { userId: string })[];
  messages: Message[];
  seq: number;
};

const DB_KEY = "t-demo-db-v1";
const SES_KEY = "t-demo-session-v1";

function nowMinus(m: number) {
  return Date.now() - m * 60_000;
}

function seedDB(): DemoDB {
  const support: User & { pass: string } = { id: "u-support", username: "support", name: "پشتیبانی T", avatar: "violet", pass: "-", verified: true };
  const sara: User & { pass: string } = { id: "u-sara", username: "sara", name: "سارا محمدی", avatar: "rose", pass: "-" };
  return {
    seq: 100,
    users: [support, sara],
    chats: [],
    messages: [
      { id: "m1", chatId: "", senderId: "u-support", text: "به پیام‌رسان «T» خوش آمدید", createdAt: nowMinus(60 * 26) },
      { id: "m2", chatId: "", senderId: "u-support", text: "اینجا می‌توانید گفتگوهایتان را شروع کنید. برای ساخت گفتگوی جدید، دکمه + را بزنید.", createdAt: nowMinus(60 * 26 - 1) },
      { id: "m3", chatId: "", senderId: "u-sara", text: "سلام! تو هم اومدی اینجا؟", createdAt: nowMinus(60 * 3) },
      { id: "m4", chatId: "", senderId: "u-sara", text: "ظاهرش خیلی شیک شده", hearts: 1, createdAt: nowMinus(60 * 3 + 1) },
      { id: "m5", chatId: "", senderId: "u-team", text: "نسخه جدید سرور «t» روی کلادفلر بالا اومد.", createdAt: nowMinus(60 * 9) },
    ],
  };
}

function loadDB(): DemoDB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const db = seedDB();
  saveDB(db);
  return db;
}
function saveDB(db: DemoDB) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function demoSetupFor(me: User): DemoDB {
  const db = loadDB();
  if (!db.chats.some((c) => c.userId === me.id)) {
    const mk = (partial: Partial<Chat> & { id: string }) =>
      ({ kind: "direct", title: "", avatar: "gold", unread: 0, ...partial, userId: me.id } as Chat & { userId: string });
    db.chats.push(
      mk({ id: "c-saved-" + me.id, kind: "saved", title: "پیام‌های ذخیره‌شده", avatar: "gold", peer: null }),
      mk({ id: "c-support-" + me.id, title: "پشتیبانی T", avatar: "violet", online: true, verified: true }),
      mk({ id: "c-sara-" + me.id, title: "سارا محمدی", avatar: "rose", online: true, unread: 2 }),
      mk({ id: "c-team-" + me.id, kind: "group", title: "تیم NeoFly", avatar: "blue" })
    );
    const bind = (mid: string, chatId: string, senderId: string) => {
      const m = db.messages.find((x) => x.id === mid);
      if (m) {
        m.chatId = chatId;
        m.senderId = senderId;
      }
    };
    bind("m1", "c-support-" + me.id, "u-support");
    bind("m2", "c-support-" + me.id, "u-support");
    bind("m3", "c-sara-" + me.id, "u-sara");
    bind("m4", "c-sara-" + me.id, "u-sara");
    bind("m5", "c-team-" + me.id, "u-team");
    saveDB(db);
  }
  return db;
}

function withLast(db: DemoDB, me: User): Chat[] {
  const list = db.chats.filter((c) => c.userId === me.id);
  return list
    .map((c) => {
      const msgs = db.messages
        .filter((m) => m.chatId === c.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      const last = msgs[0];
      return { ...c, lastText: last?.text, lastAt: last?.createdAt };
    })
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}

/* ─────────── رابط واحد ─────────── */

let mode: "live" | "demo" | null = null;
let demoUser: User | null = null;

async function detect(): Promise<"live" | "demo"> {
  if (mode) return mode;
  try {
    await tryFetch("/api/me");
    mode = "live";
  } catch (e: any) {
    if (e?.message === "no-api") mode = "demo";
    else {
      // پاسخ JSON بود ولی 401 → بک‌اند هست، فقط لاگین نیستیم
      mode = "live";
    }
  }
  return mode;
}

export const Api = {
  async me(): Promise<User | null> {
    await detect();
    if (mode === "live") {
      try {
        const d = await tryFetch("/api/me");
        return d.user;
      } catch {
        return null;
      }
    }
    const sid = localStorage.getItem(SES_KEY);
    if (!sid) return null;
    const db = loadDB();
    const u = db.users.find((x) => x.id === sid);
    if (!u) return null;
    demoUser = { id: u.id, username: u.username, name: u.name, avatar: u.avatar, verified: u.verified };
    return demoUser;
  },

  async login(username: string, password: string): Promise<User> {
    await detect();
    if (mode === "live") {
      const d = await tryFetch("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      return d.user;
    }
    const db = loadDB();
    const u = db.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
    if (!u || (u.pass !== "-" && u.pass !== password)) throw new Error("نام کاربری یا رمز عبور اشتباه است");
    if (u.pass === "-") throw new Error("این حساب نمایشی است؛ لطفاً ثبت‌نام کنید");
    localStorage.setItem(SES_KEY, u.id);
    demoUser = { id: u.id, username: u.username, name: u.name, avatar: u.avatar };
    return demoUser;
  },

  async signup(input: { name: string; username: string; password: string; avatar: string }): Promise<User> {
    await detect();
    if (mode === "live") {
      const d = await tryFetch("/api/signup", { method: "POST", body: JSON.stringify(input) });
      return d.user;
    }
    const db = loadDB();
    if (db.users.some((x) => x.username.toLowerCase() === input.username.toLowerCase()))
      throw new Error("این نام کاربری قبلاً گرفته شده است");
    const u = { id: "u-" + Math.random().toString(36).slice(2, 10), ...input, pass: input.password };
    db.users.push(u);
    saveDB(db);
    localStorage.setItem(SES_KEY, u.id);
    demoUser = { id: u.id, username: u.username, name: u.name, avatar: u.avatar };
    demoSetupFor(demoUser);
    return demoUser;
  },

  async logout(): Promise<void> {
    if (mode === "live") {
      try {
        await tryFetch("/api/logout", { method: "POST", body: "{}" });
      } catch {}
      return;
    }
    localStorage.removeItem(SES_KEY);
    demoUser = null;
  },

  async listChats(me: User): Promise<Chat[]> {
    if (mode === "live") {
      const d = await tryFetch("/api/chats");
      return d.chats;
    }
    const db = demoSetupFor(me);
    return withLast(db, me);
  },

  async messages(me: User, chatId: string): Promise<Message[]> {
    if (mode === "live") {
      const d = await tryFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`);
      return d.messages;
    }
    const db = demoSetupFor(me);
    return db.messages
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },

  async send(me: User, chatId: string, text: string, replyTo?: Message | null, fwdFrom?: string | null): Promise<Message> {
    if (mode === "live") {
      const d = await tryFetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, replyTo: replyTo?.id || null, fwdFrom: fwdFrom || null }),
      });
      return d.message;
    }
    const db = loadDB();
    const msg: Message = {
      id: "m" + ++db.seq,
      chatId,
      senderId: me.id,
      text,
      replyTo: replyTo?.id || null,
      replyText: replyTo?.text?.slice(0, 90) || null,
      fwdFrom: fwdFrom || null,
      createdAt: Date.now(),
      hearts: 0,
    };
    db.messages.push(msg);
    saveDB(db);
    return msg;
  },

  async react(messageId: string): Promise<void> {
    if (mode === "live") {
      await tryFetch(`/api/messages/${encodeURIComponent(messageId)}/react`, { method: "POST", body: JSON.stringify({ kind: "heart" }) });
      return;
    }
    const db = loadDB();
    const m = db.messages.find((x) => x.id === messageId);
    if (m) {
      m.myHeart = !m.myHeart;
      m.hearts = Math.max(0, (m.hearts || 0) + (m.myHeart ? 1 : -1));
      saveDB(db);
    }
  },

  async markRead(_me: User, chatId: string): Promise<void> {
    if (mode === "live") {
      try {
        await tryFetch(`/api/chats/${encodeURIComponent(chatId)}/read`, { method: "POST", body: "{}" });
      } catch {}
      return;
    }
    const db = loadDB();
    const c = db.chats.find((x) => x.id === chatId);
    if (c) {
      c.unread = 0;
      saveDB(db);
    }
  },

  async searchUsers(q: string): Promise<User[]> {
    if (mode === "live") {
      const d = await tryFetch("/api/users/search?q=" + encodeURIComponent(q));
      return d.users;
    }
    const db = loadDB();
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return db.users
      .filter((u) => u.pass !== "-" || true)
      .filter((u) => u.username.toLowerCase().includes(s) || u.name.includes(q.trim()))
      .map((u) => ({ id: u.id, username: u.username, name: u.name, avatar: u.avatar, verified: u.verified }));
  },

  async openDirect(me: User, username: string): Promise<Chat> {
    const target = username.replace(/^@/, "").toLowerCase();
    if (mode === "live") {
      const d = await tryFetch("/api/chats", { method: "POST", body: JSON.stringify({ kind: "direct", username: target }) });
      return d.chat;
    }
    const db = loadDB();
    const u = db.users.find((x) => x.username.toLowerCase() === target);
    if (!u) throw new Error("کاربری با این نام پیدا نشد");
    let c = db.chats.find((x) => x.userId === me.id && x.peer?.username === u.username);
    if (!c) {
      c = {
        id: "c-" + u.id + "-" + me.id,
        kind: "direct",
        title: u.name,
        avatar: u.avatar,
        peer: { id: u.id, username: u.username, name: u.name, avatar: u.avatar },
        userId: me.id,
        unread: 0,
        online: false,
      };
      db.chats.push(c);
      saveDB(db);
    }
    return c;
  },

  async createGroup(me: User, title: string, kind: "group" | "channel"): Promise<Chat> {
    if (mode === "live") {
      const d = await tryFetch("/api/chats", { method: "POST", body: JSON.stringify({ kind, title }) });
      return d.chat;
    }
    const db = loadDB();
    const c: Chat & { userId: string } = {
      id: "c-g" + ++db.seq,
      kind,
      title,
      avatar: kind === "channel" ? "teal" : "green",
      userId: me.id,
      unread: 0,
    };
    db.chats.push(c);
    db.messages.push({
      id: "m" + ++db.seq,
      chatId: c.id,
      senderId: "system",
      text: kind === "channel" ? `کانال «${title}» ساخته شد` : `گروه «${title}» ساخته شد`,
      createdAt: Date.now(),
    });
    saveDB(db);
    return c;
  },
};
