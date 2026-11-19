import { useEffect, useRef, useState } from "react";
import { CelebrateLayer } from "@/components/CelebrateLayer";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { InviteFriendsCard } from "@/components/InviteFriendsCard";
import { JoinForm } from "@/components/JoinForm";
import { OpponentChip } from "@/components/OpponentChip";
import { RematchPrompt } from "@/components/RematchPrompt";
import { RevealPanel } from "@/components/RevealPanel";
import { RoomHeader } from "@/components/RoomHeader";
import { SceneCard } from "@/components/SceneCard";
import { WordInputCard } from "@/components/WordInputCard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { copyText, inviteUrl } from "@/lib/clipboard";
import { forgetSession, loadSession, saveSession, type Session } from "@/lib/session";
import { useRoom } from "@/hooks/useRoom";
import { useRematch } from "@/hooks/useRematch";
import type { RoomView } from "@/lib/types";
import { toast } from "sonner";

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pb-28">{children}</main>;
}

function Notice({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">{text}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>重新读取</Button>
    </div>
  );
}

function JoinCard({ code, onJoined }: { code: string; onJoined: (session: Session) => void }) {
  return (
    <Shell>
      <header className="space-y-1 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">进入房间 {code}</h1>
        <p className="text-sm text-muted-foreground">这个房间里还没有属于你的位置。填个名字进来，或者换一间。</p>
      </header>
      <JoinForm code={code} onJoined={onJoined} />
      <a href="#/g/tongci" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
        回游戏首页
      </a>
    </Shell>
  );
}

function WaitingForGuest({ view, session }: { view: RoomView; session: Session }) {
  async function share() {
    const ok = await copyText(inviteUrl(view.code, "tongci"));
    toast[ok ? "success" : "error"](ok ? "邀请链接已复制，发给 TA 就能进来" : "复制失败，把口令念给 TA 也行");
  }

  return (
    <>
      <section className="rounded-2xl border bg-card p-6 text-center shadow-soft">
        <p className="text-sm text-muted-foreground">房间口令</p>
        <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.3em]">{view.code}</p>
        <p className="mt-3 text-xs text-muted-foreground">把口令或链接发给 TA，两个人都到齐就开始。</p>
        <div className="mt-5 grid gap-2">
          <Button size="lg" className="rounded-xl shadow-soft" onClick={() => void share()}>复制邀请链接</Button>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          正在等 TA 进来
        </div>
      </section>

      {/* 邀请在线好友：两个游戏共用同一张卡片，不再各自维护一份好友列表与邀请逻辑。 */}
      <InviteFriendsCard code={view.code} token={session.token} game="tongci" />
    </>
  );
}

function LockedCard({ view }: { view: RoomView }) {
  return (
    <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center shadow-soft">
      <p className="text-sm text-muted-foreground">你这一轮的词已锁定</p>
      <p className="mt-3 text-3xl font-semibold break-words">{view.myWord}</p>
      <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {view.opponentSealed ? "TA 也写好了，正在揭开" : "等 TA 写完，两个人都完成才一起揭开"}
      </div>
    </section>
  );
}

export function RoomPage({ code }: { code: string }) {
  const [session, setSession] = useState<Session | null>(() => loadSession(code));
  const room = useRoom(session);
  const [celebrationDismissed, setCelebrationDismissed] = useState(false);
  const recovering = useRef(false);
  // 再来一局：共享双方确认流程；新局开始时重置庆祝层。
  const rematch = useRematch({
    game: "tongci",
    code,
    session,
    refresh: room.refresh,
    onStarted: () => {
      saveSession(session!);
      setSession({ ...session! });
      setCelebrationDismissed(false);
    },
  });

  useEffect(() => {
    if (!room.lost || !session || recovering.current) return;
    recovering.current = true;
    // B 席位带着 joinKey 可以幂等取回原席位；A 席位没有可恢复凭据，只能重新进入。
    if (session.joinKey) {
      api.rejoin(code, session.joinKey)
        .then(result => {
          const next: Session = { ...session, code: result.code, seat: result.seat, token: result.token };
          saveSession(next);
          setSession(next);
        })
        .catch(() => {
          forgetSession(code);
          setSession(null);
        })
        .finally(() => { recovering.current = false; });
      return;
    }
    forgetSession(code);
    setSession(null);
  }, [room.lost, session, code]);

  if (!session) {
    return <JoinCard code={code} onJoined={next => { setCelebrationDismissed(false); setSession(next); }} />;
  }

  const view = room.view;
  const myName = view?.myNick || session.nick || "你";
  const opponentName = view?.opponentNick || "对方";

  async function finish() {
    const next = await room.actions?.finish();
    if (next) toast("本局已结束");
  }

  return (
    <>
      {view && <RoomHeader view={view} busy={room.busy} onFinish={() => void finish()} onLeave={() => {
        // 离开房间时若存在再赛邀请，best-effort 通知对方；跳转不等待请求完成。
        if (view.rematch) void rematch.leave();
      }} />}
      <Shell>
        {!view && (
          <div className="flex items-center justify-center gap-2 pt-20 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            正在读取房间状态
          </div>
        )}
        {view && room.notice && <Notice text={room.notice} onRetry={() => void room.refresh()} />}
        {view && view.status === "waiting" && <WaitingForGuest view={view} session={session} />}
        {view && view.status !== "waiting" && (
          <>
            <div className="flex items-center justify-between pt-4">
              <h1 className="text-lg font-semibold tracking-tight">第 {view.round} 轮</h1>
              <OpponentChip view={view} />
            </div>
            <SceneCard scene={view.scene} round={view.round} />
            <HistoryTimeline seat={view.seat} history={view.history} myNick={myName} opponentNick={opponentName} />
            {!view.mySealed && view.status === "playing" && (
              <WordInputCard
                busy={room.busy}
                disabled={false}
                onSubmit={async word => {
                  const next = await room.actions?.submit(word);
                  if (next?.matched) toast.success("遇见了");
                  return next ?? null;
                }}
              />
            )}
            {view.mySealed && !view.opponentSealed && view.status === "playing" && <LockedCard view={view} />}
            {view.mySealed && view.opponentSealed && (
              <>
                <RevealPanel view={view} />
                {view.status === "matched" ? (
                  !view.rematch && (
                    <Button size="lg" className="w-full rounded-xl" disabled={room.busy} onClick={() => void rematch.request()}>
                      再来一局
                    </Button>
                  )
                ) : view.status === "ended" ? null : (
                  <div className="space-y-2">
                    <Button
                      size="lg"
                      className="w-full rounded-xl"
                      disabled={room.busy}
                      onClick={() => void room.actions?.nextRound()}
                    >
                      下一轮
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">谁点都行，另一边会自动跟上。</p>
                  </div>
                )}
              </>
            )}
            {view.status === "ended" && (
              <section className="rounded-2xl border bg-card p-6 text-center shadow-soft">
                <p className="text-xl font-semibold">这一局停在第 {view.round} 轮</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {view.endedBy === view.seat ? "你结束了这一局。" : "TA 结束了这一局。"}
                  {view.history.length ? "上面是两个人一路说出的词。" : "两个人还没说完过一轮。"}
                </p>
                {view.mySealed && !view.opponentSealed && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    你这一轮写的是「{view.myWord}」，TA 没说完，所以按规则没有揭开。
                  </p>
                )}
                {!view.rematch && (
                  <Button size="lg" className="mt-5 w-full rounded-xl" disabled={room.busy} onClick={() => void rematch.request()}>
                    再来一局
                  </Button>
                )}
              </section>
            )}
            {/* 再来一局进度：发起方等待、对方确认/拒绝、被拒提示，两个游戏共用一张卡。 */}
            {view.rematch && (view.status === "matched" || view.status === "ended") && (
              <RematchPrompt
                info={view.rematch}
                busy={rematch.busy}
                onAccept={() => void rematch.accept()}
                onDecline={() => void rematch.decline()}
                onCancel={() => void rematch.leave()}
                onDismiss={() => void rematch.leave()}
              />
            )}
          </>
        )}
      </Shell>
      {view?.status === "matched" && view.matched && !celebrationDismissed && !view.rematch && (
        <CelebrateLayer
          winRound={view.winRound ?? view.round}
          busy={room.busy}
          onDismiss={() => setCelebrationDismissed(true)}
          onRematch={() => void rematch.request()}
        />
      )}
    </>
  );
}
