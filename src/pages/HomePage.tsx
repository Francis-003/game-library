import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, message } from "@/lib/api";
import { asGameId, gameName, gameRegistry, joinAnyGame } from "@/lib/gameRegistry";
import { loadSession, loadUser, saveSession } from "@/lib/session";
import type { FriendEntry, MyRoom } from "@/lib/types";
import { usePresence } from "@/hooks/usePresence";
import { toast } from "sonner";

const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

// 倒计时每分钟刷一次就够了：只显示到分钟，没必要每秒重渲染整个首页。
function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function remainingText(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null;
  const left = Date.parse(expiresAt) - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "即将自动销毁";
  const minutes = Math.ceil(left / 60_000);
  return `${minutes} 分钟后自动销毁`;
}

// 首页 Tab：侧边好友、口令加入、我正在进行中的房间。游戏入口只在「游戏库」Tab 里。
export function HomePage() {
  const { snapshot, rooms, refresh } = usePresence();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [friend, setFriend] = useState<FriendEntry | null>(null);
  const [inviting, setInviting] = useState(false);
  const nick = loadUser()?.name ?? "";
  const now = useNow();
  const friends = snapshot?.friends ?? [];
  const online = friends.filter(item => item.online);
  const offline = friends.filter(item => !item.online);
  const ongoing = rooms ?? [];

  // 我有一间还没开始的房，就可以直接在好友弹层里邀请他。
  const waitingRoom = ongoing.find(room => room.status === "waiting")
    ?? null;

  async function quickJoin() {
    const target = code.trim().toUpperCase();
    if (!ALPHABET.test(target)) {
      toast.error("口令是 6 位字母数字（没有 0、1、I、O）");
      return;
    }
    setPending(true);
    try {
      // 口令不属于任何具体游戏：交给注册表按顺序尝试，新增游戏时这里不用改。
      const session = await joinAnyGame(target, nick);
      if (!session) {
        toast.error("没有找到这个口令对应的房间");
        return;
      }
      saveSession(session);
      const game = asGameId(session.game);
      window.location.hash = gameRegistry[game].roomHash(session.code);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  async function inviteFriend() {
    if (!friend || !waitingRoom) return;
    // 邀请需要房间席位凭据：只在本机存过该房间时才可行，否则提示先去房间。
    const session = loadSession(waitingRoom.code, waitingRoom.game);
    if (!session) {
      toast.error("这台设备上没有那个房间的席位，先进房间再邀请。");
      return;
    }
    setInviting(true);
    try {
      await api.invite(waitingRoom.code, session.token, friend.name, waitingRoom.game);
      toast.success(`已邀请 ${friend.name}`);
      setFriend(null);
      await refresh();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setInviting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 pt-6 pb-32">
      <header className="flex items-center gap-3 px-1">
        <UserAvatar name={nick} className="size-11 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight">嗨，{nick || "…"}</h1>
          <p className="text-xs text-muted-foreground">找 TA 一起玩一会儿</p>
        </div>
        <a
          href="#/games"
          className="pressable flex shrink-0 items-center gap-1 rounded-full border bg-card px-3 py-1.5 text-xs font-medium"
        >
          游戏库
          <ChevronRight className="size-3.5" />
        </a>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 侧边好友栏：在线的人排前面，离线灰显在后，点开看详情。 */}
        <aside className="sticky top-6 flex w-12 shrink-0 flex-col items-center gap-3 self-start">
          <span className="text-[10px] leading-none text-muted-foreground">好友</span>
          {!snapshot && <span className="mt-1 size-1.5 animate-pulse rounded-full bg-muted-foreground/40" aria-hidden />}
          {snapshot && online.length === 0 && (
            <span className="mt-2 w-full text-center text-[10px] leading-tight text-muted-foreground/70">无人在线</span>
          )}
          {online.map(item => (
            <button
              key={item.name}
              onClick={() => setFriend(item)}
              className="pressable flex flex-col items-center gap-1"
              aria-label={`${item.name} 在线`}
            >
              <UserAvatar name={item.name} className="size-11 text-base" online />
              <span className="w-full truncate text-center text-[10px] text-muted-foreground">{item.name}</span>
            </button>
          ))}
          {offline.length > 0 && <span className="my-1 h-px w-6 bg-border" aria-hidden />}
          {offline.slice(0, 8).map(item => (
            <button
              key={item.name}
              onClick={() => setFriend(item)}
              className="pressable flex flex-col items-center gap-1 opacity-50"
              aria-label={`${item.name} 离线`}
            >
              <UserAvatar name={item.name} className="size-9 text-sm" />
              <span className="w-full truncate text-center text-[10px]">{item.name}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-1 space-y-4">
          <section className="rounded-2xl border bg-card p-4 shadow-soft">
            <h2 className="text-sm font-medium">用口令加入</h2>
            <p className="mt-1 text-xs text-muted-foreground">朋友把 6 位口令发给你，填进来就能进。</p>
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
            <h2 className="flex items-baseline gap-2 px-1 text-sm font-medium">
              正在进行的房间
              {rooms && <span className="text-xs font-normal text-muted-foreground">{ongoing.length}</span>}
            </h2>
            {!rooms && (
              <p className="rounded-2xl border border-dashed px-4 py-3.5 text-xs text-muted-foreground">正在读取…</p>
            )}
            {rooms && ongoing.length === 0 && (
              <p className="rounded-2xl border border-dashed px-4 py-3.5 text-xs leading-relaxed text-muted-foreground">
                现在没有进行中的房间，去游戏库开一局。
              </p>
            )}
            {ongoing.map(room => {
              const game = asGameId(room.game);
              const label = gameName(game);
              const waiting = room.status === "waiting";
              return (
                <a
                  key={`${game}:${room.code}`}
                  href={gameRegistry[game].roomHash(room.code)}
                  className="pressable block rounded-2xl border bg-card px-4 py-3.5 shadow-soft transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-lg" aria-hidden>
                      {game === "dreamer" ? "🎁" : "💬"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        <span className="font-mono tracking-[0.15em]">{room.code}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">{label}</span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {waiting ? "等待对方加入" : `${room.roundNo > 0 ? `第 ${room.roundNo} 轮` : "进行中"} · ${room.opponentNick ?? "对方"}`}
                        {room.tierName ? ` · ${room.tierName}` : ""}
                      </p>
                      {waiting && remainingText(room.expiresAt, now) && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground/80">{remainingText(room.expiresAt, now)}</p>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                </a>
              );
            })}
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
              未开始的房间 5 分钟没有开始会自动销毁。
            </p>
          </section>
        </div>
      </div>

      <Dialog open={Boolean(friend)} onOpenChange={(open) => { if (!open) setFriend(null); }}>
        <DialogContent className="max-w-[92vw] rounded-2xl sm:max-w-sm">
          {friend && (
            <>
              <DialogHeader className="items-center gap-3 text-center sm:items-center sm:text-center">
                <UserAvatar name={friend.name} className="size-16 text-2xl" online={friend.online} />
                <DialogTitle className="text-lg">{friend.name}</DialogTitle>
                <DialogDescription>
                  {friend.online ? "现在在线，可以邀请 TA 进你的房间。" : "现在不在线，等 TA 上线再来。"}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-2">
                {friend.online && waitingRoom ? (
                  <Button onClick={() => void inviteFriend()} disabled={inviting} className="w-full rounded-xl">
                    {inviting ? "邀请中…" : `邀请 TA 进房间 ${waitingRoom.code}`}
                  </Button>
                ) : null}
                {friend.online && !waitingRoom ? (
                  <Button asChild variant="outline" className="w-full rounded-xl">
                    <a href="#/games">去游戏库开一局再邀请</a>
                  </Button>
                ) : null}
                <Button variant="ghost" className="w-full rounded-xl" onClick={() => setFriend(null)}>关闭</Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
