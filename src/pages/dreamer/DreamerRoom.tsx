import { useEffect, useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoxGrid } from "./BoxGrid";
import { InviteFriendsCard } from "@/components/InviteFriendsCard";
import { RematchPrompt } from "@/components/RematchPrompt";
import { BankerConsole } from "./BankerConsole";
import { FinalPickChoice, PlayerDecide } from "./PlayerDecide";
import { OfferTimeline, ResultPanel } from "./ResultPanel";
import { useDreamer } from "@/hooks/useDreamer";
import { useRematch } from "@/hooks/useRematch";
import { api, message } from "@/lib/api";
import { copyText, inviteUrl } from "@/lib/clipboard";
import { loadSession, loadUser, newJoinKey, saveSession } from "@/lib/session";
import type { Session } from "@/lib/session";
import { toast } from "sonner";

export function DreamerRoom({ code }: { code: string }) {
  const [session, setSession] = useState<Session | null>(() => loadSession(code, "dreamer"));
  const [joinInput, setJoinInput] = useState("");
  const room = useDreamer(session);
  const view = room.view;
  // 再来一局：共享双方确认流程；新局开始时无需重置额外状态。
  const rematch = useRematch({
    game: "dreamer",
    code,
    session,
    refresh: room.refresh,
    onStarted: () => {},
  });

  // 席位凭据丢失时尝试用本地 joinKey 自愈，失败则退回加入卡片。
  // 只有加入者（seat b）有 joinKey：房主的 token 无法恢复，绝不能拿「加入」去顶替，
  // 否则房主会把自己变成对手席位。
  useEffect(() => {
    if (!room.lost || !session) return;
    if (!session.joinKey) {
      setSession(null);
      return;
    }
    const key = session.joinKey;
    let cancelled = false;
    (async () => {
      try {
        const result = await api.dreamerJoin(code, key, session.nick);
        if (cancelled) return;
        saveSession({ ...session, token: result.token });
        setSession({ ...session, token: result.token });
      } catch {
        if (!cancelled) setSession(null);
      }
    })();
    return () => { cancelled = true; };
  }, [room.lost, session, code]);

  async function joinAsGuest() {
    const key = newJoinKey();
    const nick = joinInput.trim() || loadUser()?.name || "";
    try {
      const result = await api.dreamerJoin(code, key, nick);
      saveSession({ code: result.code, seat: result.seat, token: result.token, joinKey: key, nick, game: "dreamer" });
      setSession({ code: result.code, seat: result.seat, token: result.token, joinKey: key, nick, game: "dreamer" });
    } catch (error) {
      toast.error(message(error));
    }
  }

  async function copyInvite() {
    const ok = await copyText(inviteUrl(code, "dreamer"));
    toast[ok ? "success" : "error"](ok ? "邀请链接已复制" : "复制失败，请手动复制链接");
  }

  if (!session) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-8">
        <a href="#/games" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> 游戏库
        </a>
        <div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
          <h1 className="text-lg font-bold">加入白日梦想家</h1>
          <p className="text-sm text-muted-foreground">房间口令 <span className="font-mono tracking-[0.2em]">{code}</span></p>
          <Input
            value={joinInput}
            onChange={event => setJoinInput(event.target.value)}
            placeholder="你的昵称（可留空）"
            className="h-11"
            aria-label="昵称"
          />
          <Button onClick={joinAsGuest} disabled={!code} className="w-full">加入房间</Button>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-5">
        <p className="text-muted-foreground">
          {room.notice ?? "正在读取对局…"}
        </p>
      </main>
    );
  }

  const isPlayer = view.role === "player";
  const roleLabel = isPlayer ? "🎯 玩家" : "🏦 银行家";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 py-6">
      <header className="flex items-center gap-3">
        <a href="#/games" className="text-muted-foreground hover:underline" aria-label="返回游戏库"
          onClick={() => { if (view?.rematch) void rematch.leave(); }}>
          <ArrowLeft className="size-5" />
        </a>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold">白日梦想家 · {roleLabel}</h1>
          <p className="text-xs text-muted-foreground">
            房间 {code} · {view.tierName} · {view.myNick ?? "我"} vs {view.opponentNick ?? "对方"}
          </p>
        </div>
        <Button onClick={copyInvite} size="sm" variant="outline" aria-label="复制邀请链接">
          <Copy className="size-4" />
        </Button>
      </header>

      {room.notice && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {room.notice}
          <button onClick={() => void room.refresh()} className="ml-2 underline">重试</button>
        </div>
      )}

      {view.status === "waiting" && (
        <>
          <div className="space-y-3 rounded-xl border bg-card p-5 text-center shadow-sm">
            <div className="text-4xl">⏳</div>
            <h2 className="font-semibold">等待对方加入</h2>
            <p className="text-sm text-muted-foreground">复制邀请链接发给朋友，或在下面直接邀请在线好友。</p>
            <Button onClick={copyInvite} variant="outline" className="w-full"><Copy className="mr-2 size-4" />复制邀请链接</Button>
          </div>
          <InviteFriendsCard code={code} token={session.token} game="dreamer" />
        </>
      )}

      {view.status === "playing" && (
        <>
          <section className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {view.phase === "pick_lucky" ? "盲选一个幸运箱" : view.phase === "opening" ? `第 ${view.roundNo} 轮 · 还开 ${view.openingsLeft} 个` : `第 ${view.roundNo} 轮`}
              </h2>
              <span className="text-xs text-muted-foreground">{view.boxCount} 个箱子</span>
            </div>
            <BoxGrid
              boxes={view.boxes}
              luckyBox={view.luckyBox}
              role={view.role}
              phase={view.phase}
              openingsLeft={view.openingsLeft}
              onBoxClick={no => {
                if (view.phase === "pick_lucky") void room.actions?.pickLucky(no);
                else if (view.phase === "opening") void room.actions?.open(no);
              }}
            />
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold">金额板 · 还剩这些金额</h2>
            <div className="flex flex-wrap gap-1.5">
              {view.remainingAmounts.map((amount, index) => (
                <span key={index} className="rounded-md bg-muted px-2 py-1 text-xs font-mono">{amount} 元</span>
              ))}
              {!view.remainingAmounts.length && <span className="text-xs text-muted-foreground">已全部揭晓</span>}
            </div>
          </section>

          {view.phase === "offer" || view.phase === "final_offer" ? (
            isPlayer ? (
              <div className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                等待银行家报价…
              </div>
            ) : (
              <BankerConsole
                base={view.offerBase}
                averageLeft={view.averageLeft}
                busy={room.busy}
                onOffer={(amount, line) => { void room.actions?.offer(amount, line); }}
              />
            )
          ) : null}

          {(view.phase === "decide" || view.phase === "final_decide") && view.currentOffer && (
            isPlayer ? (
              <PlayerDecide
                amount={view.currentOffer.amount}
                line={view.currentOffer.line}
                busy={room.busy}
                final={view.phase === "final_decide"}
                onDecide={deal => { void room.actions?.decide(deal); }}
              />
            ) : (
              <div className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
                等待玩家决定…
              </div>
            )
          )}

          {view.phase === "final_pick" && isPlayer && (
            <FinalPickChoice busy={room.busy} onPick={choice => { void room.actions?.finalPick(choice); }} />
          )}

          {view.phase === "final_pick" && !isPlayer && (
            <div className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              玩家正在做最后的选择…
            </div>
          )}

          {(view.phase === "pick_lucky" || view.phase === "opening") && !isPlayer && (
            <div className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
              {view.phase === "pick_lucky" ? "玩家正在盲选幸运箱…" : `玩家正在开箱，本轮还剩 ${view.openingsLeft} 个…`}
            </div>
          )}

          <OfferTimeline offers={view.offers} />
        </>
      )}

      {view.status === "ended" && view.result && (
        <>
          {view.rematch ? (
            <RematchPrompt
              info={view.rematch}
              busy={rematch.busy}
              onAccept={() => void rematch.accept()}
              onDecline={() => void rematch.decline()}
              onCancel={() => void rematch.leave()}
              onDismiss={() => void rematch.leave()}
            />
          ) : (
            <ResultPanel
              result={view.result}
              tierName={view.tierName}
              role={view.role}
              boxes={view.boxes}
              offers={view.offers}
              onRematch={() => void rematch.request()}
            />
          )}
        </>
      )}
    </main>
  );
}
