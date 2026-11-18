import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { JoinForm } from "@/components/JoinForm";
import { Button } from "@/components/ui/button";
import { api, message } from "@/lib/api";
import { loadActiveSession, loadUser, saveSession } from "@/lib/session";
import type { Session } from "@/lib/session";
import { toast } from "sonner";

const RULES = [
  ["第 1 轮", "系统给一个场景，两个人各想一个词。"],
  ["词不一样", "之后每轮没有场景，只能看着已经出现的词，猜 TA 下一轮会说什么。"],
  ["什么时候结束", "两个人说出完全相同的词，就叫“遇见”。谁先提交都不影响，两人都写完才一起揭开。"],
];

// 游戏详情页（全屏）：同词遇见的入口。开一局 / 口令加入 / 规则说明。
export function GameHome({ onEntered }: { onEntered: (session: Session) => void }) {
  const [pending, setPending] = useState(false);
  const active = loadActiveSession();
  const nick = loadUser()?.name ?? "";

  async function create() {
    setPending(true);
    try {
      const result = await api.createRoom(nick);
      const session: Session = { code: result.code, seat: result.seat, token: result.token, joinKey: null, nick };
      saveSession(session);
      onEntered(session);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-10">
      <header className="sticky top-0 z-20 -mx-4 border-b bg-background/90 px-4 backdrop-blur">
        <div className="flex items-center gap-2 py-2.5">
          <a
            href="#/"
            aria-label="返回首页"
            className="rounded-lg p-1.5 transition-colors hover:bg-accent active:scale-95"
          >
            <ArrowLeft className="size-5" />
          </a>
          <h1 className="text-base font-semibold">同词遇见</h1>
        </div>
      </header>

      <section className="hero-warm shadow-soft relative overflow-hidden rounded-2xl p-6 text-primary-foreground">
        <p className="text-5xl" aria-hidden>💬</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">同词遇见</h2>
        <p className="mt-2 text-sm leading-relaxed opacity-90">
          只有两个人玩的默契游戏：各自说一个词，说中同一个词，就算遇见。
        </p>
        <p className="mt-4 text-xs opacity-75">双人 · 文字 · 默契</p>
      </section>

      {active && (
        <a href={`#/g/tongci/r/${active.code}`} className="pressable block">
          <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5">
            <span className="size-2 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none" aria-hidden />
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium">回到房间 {active.code}</span>
              <span className="block text-xs text-muted-foreground">你们的那局还在进行</span>
            </span>
            <span className="text-xs text-primary">进入 →</span>
          </div>
        </a>
      )}

      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft">
        <h2 className="text-sm font-medium">开一局</h2>
        <Button
          size="lg"
          className="h-12 w-full rounded-xl shadow-soft"
          disabled={pending || !nick}
          onClick={() => void create()}
        >
          {pending ? "正在开" : "开始"}
        </Button>
        <p className="text-xs text-muted-foreground">开好后把口令或邀请链接发给 TA。</p>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-medium">用口令加入</h2>
        <JoinForm onJoined={onEntered} />
      </section>

      <section className="mt-auto space-y-2 rounded-2xl bg-muted/50 p-4">
        {RULES.map(([title, body]) => (
          <p key={title} className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">{title}：</span>{body}
          </p>
        ))}
      </section>
    </main>
  );
}