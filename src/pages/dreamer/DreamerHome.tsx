import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, message } from "@/lib/api";
import { DREAMER_TIERS } from "@/lib/dreamer";
import { loadUser, newJoinKey, saveSession } from "@/lib/session";
import type { DreamerRole } from "@/lib/types";
import { toast } from "sonner";

const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export function DreamerHome() {
  const [tier, setTier] = useState("standard");
  const [role, setRole] = useState<DreamerRole>("player");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    setPending(true);
    const nick = loadUser()?.name ?? "";
    try {
      const result = await api.dreamerCreate(nick, role, tier);
      saveSession({ code: result.code, seat: result.seat, token: result.token, joinKey: null, nick, game: "dreamer" });
      window.location.hash = `#/g/dreamer/r/${result.code}`;
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  async function join() {
    const target = code.trim().toUpperCase();
    if (!ALPHABET.test(target)) {
      toast.error("口令是 6 位字母数字（没有 0、1、I、O）");
      return;
    }
    setPending(true);
    const nick = loadUser()?.name ?? "";
    const joinKey = newJoinKey();
    try {
      const result = await api.dreamerJoin(target, joinKey, nick);
      saveSession({ code: result.code, seat: result.seat, token: result.token, joinKey, nick, game: "dreamer" });
      window.location.hash = `#/g/dreamer/r/${result.code}`;
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  const tierMeta = DREAMER_TIERS.find(item => item.key === tier);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-8">
      <a href="#/games" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" /> 游戏库
      </a>

      <header className="hero-warm rounded-2xl p-5 text-primary-foreground shadow-soft">
        <div className="flex items-start gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-3xl">🎁</span>
          <div>
            <h1 className="text-xl font-bold">白日梦想家</h1>
            <p className="mt-1 text-sm opacity-90">盲选幸运箱，一轮轮开箱排雷，见好就收还是赌到底？</p>
          </div>
        </div>
      </header>

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 font-semibold">怎么玩</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>一人当玩家，一人当银行家；双方都不知道箱子里有多少钱。</li>
          <li>玩家盲选一个幸运箱，全程不打开，最终归玩家。</li>
          <li>按轮翻开公共箱，开出的金额作废，金额板实时更新。</li>
          <li>每轮结束银行家报价，玩家决定成交还是继续。</li>
          <li>最后只剩幸运箱和一个公共箱，可拒绝报价并选择交换，当场揭晓。</li>
        </ol>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">选档位</h2>
        <div className="grid gap-2">
          {DREAMER_TIERS.map(item => (
            <button
              key={item.key}
              onClick={() => setTier(item.key)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${tier === item.key ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">{item.boxCount} 箱 · {item.rangeLabel}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">我的身份</h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setRole("player")}
            className={`rounded-xl border px-4 py-3 text-center transition-colors ${role === "player" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <div className="text-2xl">🎯</div>
            <div className="mt-1 font-medium">玩家</div>
            <div className="text-xs text-muted-foreground">选箱开箱、决定成交</div>
          </button>
          <button
            onClick={() => setRole("banker")}
            className={`rounded-xl border px-4 py-3 text-center transition-colors ${role === "banker" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <div className="text-2xl">🏦</div>
            <div className="mt-1 font-medium">银行家</div>
            <div className="text-xs text-muted-foreground">每轮报价、心理战</div>
          </button>
        </div>
        <Button onClick={create} disabled={pending} className="w-full">
          {pending ? "创建中…" : `创建房间 · ${tierMeta?.name}`}
        </Button>
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="font-semibold">加入朋友的房间</h2>
        <Input
          value={code}
          onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="输入 6 位口令"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="h-12 text-center font-mono text-lg tracking-[0.3em]"
          aria-label="房间口令"
        />
        <Button variant="outline" onClick={join} disabled={pending} className="w-full">加入房间</Button>
      </section>
    </main>
  );
}
