import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { BottomNav } from "@/components/BottomNav";
import type { TabKey } from "@/components/BottomNav";
import { InviteBanner } from "@/components/InviteBanner";
import { PresenceProvider } from "@/hooks/usePresence";
import { usePresence } from "@/hooks/usePresence";
import { clearUser, loadUser, saveUser } from "@/lib/session";
import type { UserAuth } from "@/lib/types";
import { findGame } from "./games";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { MePage } from "./pages/MePage";
import { LoginPage } from "./pages/LoginPage";

type Route =
  | { name: "home" }
  | { name: "games" }
  | { name: "me" }
  | { name: "game"; id: string; subPath: string }
  | { name: "redirect" }
  | { name: "missing" };

// 模板不含 react-router，用 hash 路由，配合 prepare_site 的 spa:false。
// #/ 是首页 Tab；#/games 游戏库、#/me 我的信息；每个游戏占一个 #/g/<id> 命名空间（全屏页）。
function parse(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!clean) return { name: "home" };
  if (/^games$/i.test(clean)) return { name: "games" };
  if (/^me$/i.test(clean)) return { name: "me" };

  // 旧版链接兼容：全站还是「同词遇见」独占时期的地址（#/r/口令、#/j/口令、#/scenes），
  // 重定向进它的命名空间，老邀请链接继续可用。
  const legacyRoom = clean.match(/^(?:r|j)\/([A-Za-z0-9]{6})$/i);
  if (legacyRoom) return { name: "redirect" };
  if (/^scenes$/i.test(clean)) return { name: "redirect" };

  const game = clean.match(/^g\/([a-z0-9-]+)(?:\/(.*))?$/i);
  if (game) return { name: "game", id: game[1].toLowerCase(), subPath: (game[2] ?? "").replace(/\/+$/, "") };
  return { name: "missing" };
}

function App() {
  const [hash, setHash] = useState(() => window.location.hash);
  const [user, setUser] = useState<UserAuth | null>(() => loadUser());

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 旧链接重定向：老邀请地址跳进同词遇见命名空间，不污染历史。
  useEffect(() => {
    const route = parse(hash);
    if (route.name === "redirect") {
      const clean = hash.replace(/^#\/?/, "");
      const to = /^scenes$/i.test(clean)
        ? "#/g/tongci/scenes"
        : `#/g/tongci/${clean}`;
      window.location.replace(to);
    }
  }, [hash]);

  const route = parse(hash);
  if (!user) return (
    <>
      <LoginPage onEntered={next => { saveUser(next); setUser(next); }} />
      <Toaster position="top-center" />
    </>
  );

  const authLost = () => { clearUser(); setUser(null); };
  const content = (() => {
    if (route.name === "redirect" || route.name === "missing") {
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6">
          <p className="text-muted-foreground">没有找到这个页面。</p>
          <Button onClick={() => { window.location.hash = "#/"; }}>回首页</Button>
        </main>
      );
    }
    const game = route.name === "game" ? findGame(route.id) : undefined;
    const subPath = route.name === "game" ? route.subPath : "";
    const gameContent = game ? game.render(subPath) : null;
    const tab: TabKey | null = route.name === "home" || route.name === "games" || route.name === "me"
      ? route.name : null;
    return (
      <PresenceProvider key={user.name} user={user} onAuthLost={authLost}>
        <InviteBanner offsetNav={Boolean(tab)} />
        <div className={tab ? "pb-20" : ""}>
          {route.name === "home" && <HomePage />}
          {route.name === "games" && <LibraryPage />}
          {route.name === "me" && <MePage />}
          {game && gameContent != null && gameContent}
          {game && gameContent == null && (
            <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6">
              <p className="text-muted-foreground">游戏里没有这个页面。</p>
              <Button onClick={() => { window.location.hash = "#/games"; }}>回游戏库</Button>
            </main>
          )}
        </div>
        {tab && <BottomNav active={tab} />}
        <Toaster position="top-center" />
      </PresenceProvider>
    );
  })();

  return content;
}

export default App;