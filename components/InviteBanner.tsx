import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, message } from "@/lib/api";
import { gameName, gameRegistry, asGameId } from "@/lib/gameRegistry";
import { loadUser, newJoinKey, saveSession } from "@/lib/session";
import { usePresence } from "@/hooks/usePresence";
import { toast } from "sonner";
import type { InviteEntry } from "@/lib/types";

// 全局邀请条：被邀请在任何页面都会看到，进入即走现有 join 流程。
// offsetNav 为 true 时抬到底部导航栏上方，避免与三个 Tab 的底栏重叠。
export function InviteBanner({ offsetNav = false }: { offsetNav?: boolean }) {
  const { snapshot, refresh } = usePresence();
  const [busy, setBusy] = useState(false);
  const invites = snapshot?.invites ?? [];

  if (!invites.length) return null;

  async function accept(invite: InviteEntry) {
    const user = loadUser();
    if (!user) return;
    setBusy(true);
    try {
      // 加入与跳转全部交给游戏注册表：接受邀请的逻辑不再按游戏写分支。
      const game = asGameId(invite.game);
      const session = await gameRegistry[game].join(invite.roomCode, newJoinKey(), user.name);
      saveSession(session);
      await api.dismissInvite(user.token, invite.id);
      await refresh();
      window.location.hash = gameRegistry[game].roomHash(session.code);
    } catch (error) {
      toast.error(message(error));
      // 房间可能已满或已结束：把这个邀请清掉，避免条目一直挂着。
      await api.dismissInvite(user.token, invite.id).catch(() => undefined);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function ignore(invite: InviteEntry) {
    const user = loadUser();
    if (!user) return;
    try {
      await api.dismissInvite(user.token, invite.id);
      await refresh();
    } catch {
      toast.error("没能忽略这条邀请，稍后再试。");
    }
  }

  return (
    <div
      className="fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4"
      style={{ bottom: offsetNav ? "calc(4.75rem + env(safe-area-inset-bottom))" : "1rem" }}
    >
      {invites.map((invite) => (
        <div key={invite.id} className="w-full max-w-md rounded-2xl border bg-card p-3.5 shadow-soft animate-in slide-in-from-bottom-4 fade-in duration-300">
          <p className="text-sm leading-relaxed">
            <span className="font-medium">{invite.fromName}</span>
            <span className="text-muted-foreground">
              {" "}邀请你进入{gameName(invite.game)}房间{" "}
            </span>
            <span className="font-mono font-semibold tracking-[0.15em]">{invite.roomCode}</span>
          </p>
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="rounded-lg" disabled={busy} onClick={() => void ignore(invite)}>忽略</Button>
            <Button size="sm" className="rounded-lg" disabled={busy} onClick={() => void accept(invite)}>进入</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
