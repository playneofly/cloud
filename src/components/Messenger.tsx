import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, Bookmark, CheckCheck, ChevronRight, Copy, Forward, Heart, LogOut,
  Megaphone, MessageCircle, Paperclip, Pencil, Phone, Reply, Search, Send, Settings2, Users, X,
} from "lucide-react";
import { Api, type Chat, type Message, type User } from "../api";

const timeFmt = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long" });
const faNum = (n: number) => n.toLocaleString("fa-IR");
const sameDay = (a: number, b: number) => {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

function Avatar({ chat, sm }: { chat: Pick<Chat, "title" | "avatar" | "online">; sm?: boolean }) {
  return (
    <div className={`avatar ${sm ? "sm" : ""} av-${chat.avatar}`}>
      {chat.title.trim().slice(0, 1) || "T"}
      {chat.online !== undefined && <span className={`dot ${chat.online ? "" : "off"}`} />}
    </div>
  );
}

type Panel = "none" | "compose" | "direct" | "group" | "channel" | "forward" | "settings";

export default function Messenger({ me, onLogout }: { me: User; onLogout: () => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState<Chat | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Message | null>(null);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [fwdMsg, setFwdMsg] = useState<Message | null>(null);
  const [found, setFound] = useState<User[]>([]);
  const [directQ, setDirectQ] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const savedChat = useMemo(() => chats.find((c) => c.kind === "saved"), [chats]);
  const visibleChats = useMemo(
    () => chats.filter((c) => !query.trim() || c.title.includes(query.trim()) || (c.lastText || "").includes(query.trim())),
    [chats, query]
  );

  useEffect(() => {
    Api.listChats(me).then(setChats);
  }, [me]);

  useEffect(() => {
    if (!active) return;
    Api.messages(me, active.id).then((m) => {
      setMsgs(m);
      scrollDown();
    });
    Api.markRead(me, active.id);
    setChats((cs) => cs.map((c) => (c.id === active.id ? { ...c, unread: 0 } : c)));
    setReply(null);
  }, [active?.id]);

  function scrollDown() {
    requestAnimationFrame(() => {
      const el = msgsRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function openChat(c: Chat) {
    setActive(c);
    setPanel("none");
  }

  async function refreshChats() {
    setChats(await Api.listChats(me));
  }

  async function sendNow() {
    const t = text.trim();
    if (!t || !active) return;
    setText("");
    autoGrow();
    const temp: Message = {
      id: "tmp-" + Date.now(), chatId: active.id, senderId: me.id, text: t,
      replyTo: reply?.id || null, replyText: reply?.text?.slice(0, 90) || null, createdAt: Date.now(), hearts: 0,
    };
    setMsgs((m) => [...m, temp]);
    setPendingId(temp.id);
    setReply(null);
    scrollDown();
    const saved = await Api.send(me, active.id, t, null, null);
    setMsgs((m) => m.map((x) => (x.id === temp.id ? { ...saved, replyText: temp.replyText, replyTo: temp.replyTo } : x)));
    setPendingId(null);
    scrollDown();
    refreshChats();
    taRef.current?.focus();
  }

  async function doSend(replyOverride?: Message | null, fwdFrom?: string | null, target?: Chat) {
    const chat = target || active;
    if (!chat) return;
    const t = target ? (fwdMsg?.text || "") : text.trim();
    if (!t) return;
    const saved = await Api.send(me, chat.id, t, replyOverride || null, fwdFrom || null);
    if (chat.id === active?.id) {
      setMsgs((m) => [...m, saved]);
      scrollDown();
    }
    refreshChats();
  }

  async function heart(m: Message) {
    setMsgs((ms) => ms.map((x) => (x.id === m.id ? { ...x, myHeart: !x.myHeart, hearts: Math.max(0, (x.hearts || 0) + (x.myHeart ? -1 : 1)) } : x)));
    await Api.react(m.id);
  }

  async function searchPeople(q: string) {
    setDirectQ(q);
    if (q.trim().length < 2) return setFound([]);
    setFound(await Api.searchUsers(q));
  }

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(140, el.scrollHeight) + "px";
  }

  const railBtn = (label: string, node: React.ReactNode, act = false, onClick?: () => void) => (
    <button className={`icon ${act ? "active" : ""}`} title={label} aria-label={label} onClick={onClick}
      style={act ? { color: "var(--gold)", borderColor: "var(--line)", background: "#e0b84d14" } : undefined}>
      {node}
    </button>
  );

  return (
    <div className={`shell ${active ? "chat-open" : ""}`}>
      {/* ریل کناری */}
      <aside className="rail">
        <div className="mark"><span>T</span></div>
        <nav>
          {railBtn("گفتگوها", <MessageCircle />, true, () => setActive(null))}
          {railBtn("پیام‌های ذخیره‌شده", <Bookmark />, false, () => savedChat && openChat(savedChat))}
          {railBtn("تنظیمات", <Settings2 />, false, () => setPanel("settings"))}
        </nav>
        <button className="icon" title="خروج" aria-label="خروج" onClick={async () => { await Api.logout(); onLogout(); }}>
          <LogOut />
        </button>
        <div className={`avatar sm av-${me.avatar} me-avatar`} title={me.name}>{me.name.slice(0, 1)}</div>
      </aside>

      {/* ستون لیست گفتگوها */}
      <section className="col">
        <div className="col-head">
          <div>
            <h2>پیام‌ها</h2>
            <p>پیام‌رسان T</p>
          </div>
          <div className="col-tools">
            <button className="iconbtn" title="ویرایش" aria-label="ویرایش"><Pencil /></button>
          </div>
        </div>
        <input className="search" placeholder="جستجو…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="list">
          {visibleChats.map((c) => (
            <button key={c.id} className={`row ${active?.id === c.id ? "active" : ""}`} onClick={() => openChat(c)}>
              <Avatar chat={c.kind === "saved" || c.kind === "group" || c.kind === "channel" ? { ...c, online: undefined } : c} />
              <div className="meta">
                <div className="name">
                  {c.title}
                  {c.verified && <BadgeCheck className="vchk" />}
                </div>
                <div className="preview">{c.lastText || (c.kind === "channel" ? "کانال" : c.kind === "group" ? "گروه" : c.kind === "saved" ? "یادداشت‌های شخصی" : "شروع گفتگو…")}</div>
              </div>
              <div className="side">
                {c.lastAt && <span className="when">{timeFmt.format(c.lastAt)}</span>}
                {!!c.unread && <span className="unread">{faNum(c.unread)}</span>}
              </div>
            </button>
          ))}
          {!visibleChats.length && <div className="list-empty">چیزی پیدا نشد.</div>}
        </div>
        <button className="fab-plus" title="گفتگوی جدید" aria-label="گفتگوی جدید" onClick={() => setPanel("compose")}>
          <X style={{ transform: "rotate(45deg)" }} />
        </button>
      </section>

      {/* صحنه */}
      <main className="stage">
        {!active ? (
          <div className="stage-empty">
            <div>
              <p className="giant">T</p>
              <h3>پیام‌رسان T</h3>
              <p>یک گفتگو را انتخاب کنید تا پیام‌ها اینجا نمایش داده شود.</p>
            </div>
          </div>
        ) : (
          <div className="chat-pane">
            <div className="topbar">
              <button className="backonly" onClick={() => setActive(null)} aria-label="بازگشت"><ChevronRight /></button>
              <div className="who">
                <Avatar chat={active} sm />
                <div>
                  <b>{active.title}{active.verified && <BadgeCheck className="vchk" />}</b>
                  <span>{active.kind === "saved" ? "فقط برای خودتان" : active.kind === "group" ? "گروه" : active.kind === "channel" ? "کانال" : active.online ? "آنلاین" : "آخرین بازدید اخیراً"}</span>
                </div>
              </div>
              <button className="iconbtn" title="تماس صوتی" aria-label="تماس صوتی"><Phone /></button>
              <button className="iconbtn" title="جستجو" aria-label="جستجو"><Search /></button>
            </div>

            <div className="msgs" ref={msgsRef}>
              {msgs.map((m, i) => {
                const sys = m.senderId === "system";
                const mine = m.senderId === me.id || m.senderId === "u-local";
                const prev = msgs[i - 1];
                const showDay = !prev || !sameDay(prev.createdAt, m.createdAt);
                if (sys)
                  return (
                    <div key={m.id} className="msg-line system"><div className="bubble system">{m.text}</div></div>
                  );
                return (
                  <div key={m.id}>
                    {showDay && <div className="day">{dayFmt.format(m.createdAt)}</div>}
                    <div className={`msg-line ${mine ? "is-mine" : "is-theirs"} ${m.id === pendingId ? "pending" : ""}`}>
                      <div className={`bubble ${mine ? "mine" : ""}`}>
                        <div className="b-tools">
                          <button title="قلب" onClick={() => heart(m)}><Heart size={13} /></button>
                          <button title="پاسخ" onClick={() => setReply(m)}><Reply size={13} /></button>
                          <button title="بازگردانی" onClick={() => { setFwdMsg(m); setPanel("forward"); }}><Forward size={13} /></button>
                          <button title="کپی" onClick={() => navigator.clipboard?.writeText(m.text)}><Copy size={13} /></button>
                        </div>
                        {m.fwdFrom && <div className="fwd">بازگردانده شده از {m.fwdFrom}</div>}
                        {m.replyTo && m.replyText && <div className="quote">{m.replyText}</div>}
                        <div className="txt">{m.text}</div>
                        <div className="foot">
                          {(m.hearts || 0) > 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: m.myHeart ? "var(--gold)" : undefined }}>
                              <Heart size={11} fill={m.myHeart ? "currentColor" : "none"} /> {faNum(m.hearts || 0)}
                            </span>
                          )}
                          <span>{timeFmt.format(m.createdAt)}</span>
                          {mine && <CheckCheck className={m.seen ? "seen" : ""} />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!msgs.length && <div className="stage-empty" style={{ padding: 20 }}><p>هنوز پیامی نیست؛ اولین پیام را بفرستید.</p></div>}
            </div>

            {reply && (
              <div className="replybar">
                <Reply size={14} style={{ color: "var(--gold)", flex: "none" }} />
                <div className="q">{reply.text}</div>
                <button onClick={() => setReply(null)} aria-label="بستن"><X /></button>
              </div>
            )}

            <div className="composer" style={reply ? { paddingTop: 0 } : undefined}>
              <div className="box" style={reply ? { borderRadius: "0 0 18px 18px", borderTop: 0 } : undefined}>
                <button className="attach" title="پیوست" aria-label="پیوست"><Paperclip /></button>
                <textarea
                  ref={taRef}
                  rows={1}
                  placeholder="پیام بنویسید…"
                  value={text}
                  onChange={(e) => { setText(e.target.value); autoGrow(); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); reply ? doSend(reply, null) : sendNow(); } }}
                />
              </div>
              <button className="sendbtn" disabled={!text.trim()} onClick={() => (reply ? doSend(reply, null) : sendNow())} title="ارسال" aria-label="ارسال">
                <Send />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* مودال‌ها */}
      {panel !== "none" && (
        <div className="modal-veil" onClick={() => setPanel("none")}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {panel === "compose" && (
              <>
                <h3>شروع کنید</h3>
                <p className="sub">یک راه برای گفتگو انتخاب کنید</p>
                <button className="compose-opt" onClick={() => setPanel("direct")}>
                  <b><MessageCircle /> گفتگوی جدید</b>
                  <small>شروع چت خصوصی با یک نفر</small>
                </button>
                <button className="compose-opt" onClick={() => setPanel("group")}>
                  <b><Users /> گروه جدید</b>
                  <small>گفتگوی دسته‌جمعی با دوستان</small>
                </button>
                <button className="compose-opt" onClick={() => setPanel("channel")}>
                  <b><Megaphone /> کانال جدید</b>
                  <small>پخش پیام برای مخاطبان</small>
                </button>
              </>
            )}

            {panel === "direct" && (
              <>
                <h3>گفتگوی جدید</h3>
                <p className="sub">نام کاربری یا نام شخص را جستجو کنید</p>
                <div className="field">
                  <input dir="ltr" placeholder="@username" value={directQ} onChange={(e) => searchPeople(e.target.value)} autoFocus />
                </div>
                {found.map((u) => (
                  <button key={u.id} className="row" onClick={async () => openChat(await Api.openDirect(me, u.username))}>
                    <div className={`avatar av-${u.avatar}`}>{u.name.slice(0, 1)}</div>
                    <div className="meta">
                      <div className="name">{u.name}{u.verified && <BadgeCheck className="vchk" />}</div>
                      <div className="preview" dir="ltr" style={{ textAlign: "right" }}>@{u.username}</div>
                    </div>
                    <span />
                  </button>
                ))}
                {!found.length && directQ.trim().length >= 2 && <div className="list-empty">کاربری پیدا نشد.</div>}
              </>
            )}

            {(panel === "group" || panel === "channel") && (
              <>
                <h3>{panel === "group" ? "گروه جدید" : "کانال جدید"}</h3>
                <p className="sub">یک نام برای {panel === "group" ? "گروه" : "کانال"} انتخاب کنید</p>
                <div className="field">
                  <input placeholder={panel === "group" ? "نام گروه…" : "نام کانال…"} value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} autoFocus />
                </div>
                <button
                  className="btn-gold"
                  disabled={!groupTitle.trim()}
                  onClick={async () => {
                    const c = await Api.createGroup(me, groupTitle.trim(), panel as "group" | "channel");
                    setGroupTitle("");
                    await refreshChats();
                    openChat(c);
                  }}
                >
                  ساخت
                </button>
              </>
            )}

            {panel === "forward" && fwdMsg && (
              <>
                <h3>بازگردانی به…</h3>
                <p className="sub">«{fwdMsg.text.slice(0, 60)}»</p>
                {chats.map((c) => (
                  <button key={c.id} className="row" onClick={async () => {
                    await doSend(null, active?.title || null, c);
                    setFwdMsg(null);
                    setPanel("none");
                  }}>
                    <Avatar chat={c} />
                    <div className="meta"><div className="name">{c.title}</div></div>
                    <span />
                  </button>
                ))}
              </>
            )}

            {panel === "settings" && (
              <>
                <h3>تنظیمات</h3>
                <p className="sub">حساب T شما</p>
                <div className="avatar-picker">
                  <div className={`avatar lg av-${me.avatar}`}>{me.name.slice(0, 1)}</div>
                  <div>
                    <div style={{ textAlign: "center", fontWeight: 700 }}>{me.name}</div>
                    <div style={{ textAlign: "center", color: "var(--mute)", fontSize: 12 }} dir="ltr">@{me.username}</div>
                  </div>
                </div>
                <button className="btn-ghost" onClick={async () => { await Api.logout(); onLogout(); }}>
                  <LogOut size={14} style={{ verticalAlign: "-2px", marginInlineEnd: 6 }} /> خروج از حساب
                </button>
                <p className="hintline">T — playneofly.ir</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
