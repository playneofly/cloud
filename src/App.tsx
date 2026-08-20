import { useEffect, useState } from "react";
import { Api, type User } from "./api";
import AuthOverlay from "./components/AuthOverlay";
import Messenger from "./components/Messenger";

export default function App() {
  const [me, setMe] = useState<User | null>(null);

  // بدون لودر: پنل ورود بلافاصله دیده می‌شود؛ اگر نشست فعال باشد، جایگزین می‌شود
  useEffect(() => {
    Api.me().then((u) => setMe(u));
  }, []);

  return (
    <>
      <div className="app-bg" />
      {me ? <Messenger me={me} onLogout={() => setMe(null)} /> : <AuthOverlay onAuth={setMe} />}
    </>
  );
}
