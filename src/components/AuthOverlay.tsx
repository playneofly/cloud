import { useState } from "react";
import { ArrowLeft, LogIn, UserRoundPlus } from "lucide-react";
import { Api, type User } from "../api";

const AVATARS = ["gold", "violet", "blue", "rose", "green", "teal"] as const;

export default function AuthOverlay({ onAuth }: { onAuth: (u: User) => void }) {
  const [side, setSide] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // فیلدهای ورود
  const [lu, setLu] = useState("");
  const [lp, setLp] = useState("");

  // فیلدهای ثبت‌نام
  const [name, setName] = useState("");
  const [su, setSu] = useState("");
  const [sp, setSp] = useState("");
  const [avatar, setAvatar] = useState<string>("gold");

  const flip = (s: "login" | "signup") => {
    setErr("");
    setSide(s);
  };

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!lu.trim() || !lp) return setErr("نام کاربری و رمز عبور را وارد کنید");
    setBusy(true);
    try {
      const u = await Api.login(lu.trim(), lp);
      onAuth(u);
    } catch (ex: any) {
      setErr(ex?.message || "ورود ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!name.trim()) return setErr("نام نمایشی را وارد کنید");
    if (!/^[a-zA-Z0-9_]{3,}$/.test(su.trim())) return setErr("نام کاربری باید حداقل ۳ حرف انگلیسی یا عدد باشد");
    if (sp.length < 4) return setErr("رمز عبور باید حداقل ۴ کاراکتر باشد");
    setBusy(true);
    try {
      const u = await Api.signup({ name: name.trim(), username: su.trim(), password: sp, avatar });
      onAuth(u);
    } catch (ex: any) {
      setErr(ex?.message || "ثبت‌نام ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="ltr" id="loginOverlay">
      <div className="LoWatermark"><span>T</span></div>

      <div className="lo-mark">
        <div className="mk">T</div>
        <div className="wm">T — Messenger</div>
      </div>

      <div className="lo-wrap">
        {/* زبانه‌های کناری */}
        <div className="lo-side">
          <p className={side === "login" ? "on" : ""} onClick={() => flip("login")}>
            <span id="sideLogin">Log in</span>
          </p>
          <p className={side === "signup" ? "on" : ""} onClick={() => flip("signup")}>
            <span id="sideSignup">Sign up</span>
          </p>
        </div>

        <div id="flipInner" className={side === "signup" ? "flipped" : ""}>
          {/* ورود */}
          <div className="face front">
            <h1>Log <em>in</em></h1>
            <p className="under">به حساب T خود وارد شوید</p>
            <form onSubmit={submitLogin} dir="rtl">
              <div className="field">
                <label htmlFor="lu">نام کاربری</label>
                <input id="lu" dir="ltr" autoComplete="username" value={lu} onChange={(e) => setLu(e.target.value)} placeholder="username" />
              </div>
              <div className="field">
                <label htmlFor="lp">رمز عبور</label>
                <input id="lp" dir="ltr" type="password" autoComplete="current-password" value={lp} onChange={(e) => setLp(e.target.value)} placeholder="••••••••" />
              </div>
              <a className="forgot" href="#" onClick={(e) => e.preventDefault()}>رمز را فراموش کرده‌اید؟</a>
              <p className="err">{err && side === "login" ? err : ""}</p>
              <button className="btn-gold" disabled={busy} type="submit">
                {busy ? "..." : "ورود"} <LogIn size={16} style={{ verticalAlign: "-3px", marginInlineStart: 6 }} />
              </button>
              <p className="swapnote">حساب ندارید؟ <b onClick={() => flip("signup")}>ثبت‌نام</b></p>
            </form>
          </div>

          {/* ثبت‌نام */}
          <div className="face back">
            <h1>Sign <em>up</em></h1>
            <p className="under">حساب T بسازید</p>
            <form onSubmit={submitSignup} dir="rtl">
              <div className="avatar-picker" style={{ marginTop: 0 }}>
                <div className={`avatar lg av-${avatar}`}>{(name.trim() || "T").slice(0, 1)}</div>
                <div className="av-swatches">
                  {AVATARS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      className={`av-swatch av-${a} ${avatar === a ? "on" : ""}`}
                      onClick={() => setAvatar(a)}
                    >
                      {(name.trim() || "T").slice(0, 1)}
                    </button>
                  ))}
                </div>
                <div className="avatar-pick-hint">رنگ آواتار خود را انتخاب کنید</div>
              </div>
              <div className="field">
                <label htmlFor="sn">نام نمایشی</label>
                <input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: سارا محمدی" />
              </div>
              <div className="field">
                <label htmlFor="su">نام کاربری</label>
                <input id="su" dir="ltr" autoComplete="username" value={su} onChange={(e) => setSu(e.target.value)} placeholder="username" />
              </div>
              <div className="field">
                <label htmlFor="sp">رمز عبور</label>
                <input id="sp" dir="ltr" type="password" autoComplete="new-password" value={sp} onChange={(e) => setSp(e.target.value)} placeholder="••••••••" />
              </div>
              <p className="err">{err && side === "signup" ? err : ""}</p>
              <button className="btn-gold" disabled={busy} type="submit">
                {busy ? "..." : "ساخت حساب"} <UserRoundPlus size={16} style={{ verticalAlign: "-3px", marginInlineStart: 6 }} />
              </button>
              <p className="swapnote">حساب دارید؟ <b onClick={() => flip("login")}>ورود</b></p>
            </form>
          </div>
        </div>

        <div className="lo-side" style={{ visibility: "hidden" }}>
          <p><span>Log in</span></p>
          <p><span>Sign up</span></p>
        </div>
      </div>

      <div className="lo-tag">playneofly.ir <ArrowLeft size={11} style={{ verticalAlign: "-1px", margin: "0 6px" }} /> T</div>
    </div>
  );
}
