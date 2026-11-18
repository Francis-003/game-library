import { useState } from "react";
import { LogOut, ChevronRight } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { clearUser, listSessions } from "@/lib/session";
import { usePresence } from "@/hooks/usePresence";

// 我的信息 Tab：账号卡片、本机房间记录、退出登录。没有云端战绩数据，保持本地视角。
export function MePage() {
  const { snapshot } = usePresence();
  const [rooms] = useState(() => listSessions());
  const name = snapshot?.name ?? "";

  function logout() {
    clearUser();
    // 整页重载回到登录门，顺便清掉所有内存态。
    window.location.reload();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 pt-6 pb-32">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">我的</h1>
        <p className="text-sm text-muted-foreground">账号与设备上的房间记录。</p>
      </header>

      <section className="flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-soft">
        <UserAvatar name={name} className="size-14 text-2xl" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-lg font-semibold">
            {name || "…"}
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
              <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
              在线
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">无密码账号 · 凭据保存在本设备</p>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-sm font-medium">我的房间</h2>
        {rooms.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">
            还没有进行过的房间，去 <a href="#/games" className="text-primary underline-offset-4 hover:underline">游戏库</a> 开一局吧。
          </div>
        ) : (
          <div className="divide-y rounded-2xl border bg-card shadow-soft">
            {rooms.map(room => (
              <a key={room.code} href={`#/g/tongci/r/${room.code}`} className="pressable flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-base font-semibold tracking-[0.2em]">{room.code}</span>
                <span className="text-xs text-muted-foreground">{room.seat === "a" ? "房主" : "成员"} · {room.nick}</span>
                <span className="min-w-0 flex-1" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-soft">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full rounded-xl text-destructive hover:text-destructive">
              <LogOut className="size-4" />
              退出登录
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-[92vw] rounded-2xl sm:max-w-sm">
            <AlertDialogHeader>
              <AlertDialogTitle>退出登录？</AlertDialogTitle>
              <AlertDialogDescription>
                设备上的登录凭据会被清除，房间记录保留在本机。下次进入需要重新输入用户名。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>再想想</AlertDialogCancel>
              <AlertDialogAction onClick={logout}>退出</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="text-center text-xs text-muted-foreground">
          游戏库 · 第一个游戏「同词遇见」
        </p>
      </section>
    </main>
  );
}