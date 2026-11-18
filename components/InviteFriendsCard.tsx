import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, message } from "@/lib/api";
import { usePresence } from "@/hooks/usePresence";
import { toast } from "sonner";

// 等待好友加入时共用的「在线好友 + 一键邀请」卡片。两个游戏都用它，
// 会话里的 token 只在本机，因此只有持有席位的设备才传得进来。
export function InviteFriendsCard({ code, token, game }: {
  code: string;
  token: string;
  game?: string;
}) {
  const { snapshot } = usePresence();
  const [invitedTo, setInvitedTo] = useState<string[]>([]);
  const online = (snapshot?.friends ?? []).filter(friend => friend.online);

  async function invite(name: string) {
    try {
      await api.invite(code, token, name, game);
      setInvitedTo(prev => prev.includes(name) ? prev : [...prev, name]);
      toast.success(`已邀请 ${name}，等 TA 进入`);
    } catch (error) {
      toast.error(message(error));
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-soft">
      <h2 className="text-sm font-medium">邀请在线好友</h2>
      {!snapshot && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" /> 正在读取好友状态
        </p>
      )}
      {snapshot && online.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">现在没有好友在线，复制口令发给 TA 也行。</p>
      )}
      {online.map(friend => (
        <div key={friend.name} className="mt-2 flex items-center gap-3 rounded-lg border px-3 py-2">
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm">{friend.name}</span>
          {invitedTo.includes(friend.name) ? (
            <span className="text-xs text-muted-foreground">已邀请</span>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => void invite(friend.name)}>邀请</Button>
          )}
        </div>
      ))}
    </section>
  );
}
