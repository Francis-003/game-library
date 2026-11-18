import { useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, message } from "@/lib/api";
import { loadUser, loadSession, newJoinKey, saveSession } from "@/lib/session";
import type { Session } from "@/lib/session";
import { usePresence } from "@/hooks/usePresence";
import { toast } from "sonner";

const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

// 首页 Tab：继续游戏、推荐游戏、口令快速加入、在线好友。
export function HomePage() {
  const { snapshot } = usePresence();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const active = loadSession();
  const nick = loadUser()?.name ?? "";
  const onlineFriends = (snapshot?.friends ?? []).filter(friend => friend.online);

  async function quickJoin() {
    const target = code.trim().toUpperCase();
    if (!ALPHABET.test(target)) {
      toast.error("口令是 6 位字母数字（没有 0、1、I、O）");
      return;
    }
    setPending(true);
    const joinKey = newJoinKey();
    try {
      const result = await api.joinRoom(target, joinKey, nick);
      const session: Session = { code: result.code, seat: result.seat, token: result.token, joinKey, nick };
      saveSession(session);
      window.location.hash = `#/g/tongci/r/${result.code}`;
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 pt-6 pb-32">
      <header className="flex items-center gap-3">
        <UserAvatar name={nick} className="size-11 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">嗨，{nick || "…"}</h1>
          <p className="text-xs text-muted-foreground">找 TA 一起玩一会儿</p>
        </div>
        <a
          href="#/games"
          className="pressable flex items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium"
        >
          游戏库
          <ChevronRight className="size-3.5" />
        </a>
      </header>

      {active && (
        <a href={`#/g/tongci/r/${active.code}`} className="pressable block">
          <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5">
            <span className="size-2 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none" aria-hidden />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">回到房间 {active.code}</span>
              <span className="block text-xs text-muted-foreground">你们的那局还在进行</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-primary" />
          </div>
        </a>
      )}

      <a href="#/g/tongci" className="pressable hero-warm shadow-soft block rounded-2xl p-5 text-primary-foreground">
        <div className="flex items-start gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-3xl" aria-hidden>
            💬
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tracking-tight">同词遇见</p>
            <p className="mt-1 text-sm leading-relaxed opacity-90">
              各自说一个词，说中同一个词，就算遇见。
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs opacity-80">双人 · 文字 · 默契</span>
          <span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold">去开一局 →</span>
        </div>
      </a>

      <section className="rounded-2xl border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-medium">用口令加入</h2>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void quickJoin();
          }}
        >
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="输入 6 位口令"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 rounded-xl font-mono text-lg tracking-[0.25em]"
            aria-label="房间口令"
          />
          <Button
            type="submit"
            size="lg"
            className="h-12 shrink-0 rounded-xl px-5"
            disabled={pending || !code}
          >
            {pending ? "进入中" : "进入"}
          </Button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-medium">
          在线好友{snapshot ? ` · ${onlineFriends.length}` : ""}
        </h2>
        {!snapshot && (
          <p className="flex items-center gap-2 rounded-xl px-1 py-2 text-xs text-muted-foreground">
            正在读取好友状态…
          </p>
        )}
        {snapshot && onlineFriends.length === 0 && (
          <p className="rounded-2xl border border-dashed px-4 py-3.5 text-xs leading-relaxed text-muted-foreground">
            现在没有好友在线。把口令发给 TA，上线后就会出现在这里。
          </p>
        )}
        {snapshot && onlineFriends.length > 0 && (
          <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-none">
            {onlineFriends.map(friend => (
              <a key={friend.name} href="#/g/tongci" className="pressable flex w-14 shrink-0 flex-col items-center gap-1.5">
                <UserAvatar name={friend.name} className="size-12 text-lg" online />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">{friend.name}</span>
              </a>
            ))}
          </div>
        )}
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          所有用户自动互为好友；点头像去开一局，再邀请 TA。
        </p>
      </section>
    </main>
  );
}