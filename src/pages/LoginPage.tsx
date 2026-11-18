import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, message } from "@/lib/api";
import { lastNick } from "@/lib/session";
import type { UserAuth } from "@/lib/types";
import { toast } from "sonner";

// 无密码登录门：用户名即账号，先到先得。上次的游戏昵称作为预填建议。
export function LoginPage({ onEntered }: { onEntered: (user: UserAuth) => void }) {
  const [name, setName] = useState(lastNick());
  const [pending, setPending] = useState(false);

  async function enter() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("先给自己起个名字吧");
      return;
    }
    setPending(true);
    try {
      const auth = await api.login(trimmed);
      onEntered(auth);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 pb-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <div className="hero-warm shadow-soft flex size-20 items-center justify-center rounded-3xl text-4xl" aria-hidden>
          🎲
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">游戏库</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            输入用户名就能进入，不用密码。
            <br />
            名字就是你的账号：同名直接进入，新名字自动创建。
          </p>
        </div>
      </header>

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-soft">
        <h2 className="text-sm font-medium">你是谁？</h2>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 12))}
            placeholder="用户名（12 字以内）"
            maxLength={12}
            className="h-12 min-w-0 flex-1 rounded-xl"
            aria-label="用户名"
            onKeyDown={(event) => { if (event.key === "Enter") void enter(); }}
          />
          <Button size="lg" className="h-12 shrink-0 rounded-xl px-6" disabled={pending} onClick={() => void enter()}>
            {pending ? "正在进入" : "进入"}
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          所有用户自动互为好友；超过 2 小时不登录，账号会自动清除。
        </p>
      </section>
    </main>
  );
}