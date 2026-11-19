import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, message } from "@/lib/api";
import type { GameId } from "@/lib/gameRegistry";
import type { Session } from "@/lib/session";

// 再来一局的共享操作层：两个游戏共用一套「发起 / 接受 / 拒绝 / 取消」流程。
// 状态本身来自服务端下发的 view.rematch，不在这里另存一份，避免两端视图漂移。
export function useRematch({ game, code, session, refresh, onStarted }: {
  game: GameId;
  code: string;
  session: Session | null;
  refresh: () => Promise<unknown>;
  // 双方确认、新局开始时的回调（重置庆祝层等游戏内状态）。
  onStarted: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (
    action: () => Promise<{ started: boolean }>,
    successMessage?: string,
  ) => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await action();
      if (result.started) {
        onStarted();
        toast.success("双方都准备好了，新的一局开始");
      } else if (successMessage) {
        toast.success(successMessage);
      }
      await refresh();
    } catch (error) {
      toast.error(message(error));
    } finally {
      setBusy(false);
    }
  }, [session, refresh, onStarted]);

  return {
    busy,
    // 发起即算本人确认：写 pending，等待对方；若对方已发起则直接开局。
    request: () => run(() => api.rematchRequest(game, code, session!.token), "已发出邀请，等 TA 确认"),
    accept: () => run(() => api.rematchRespond(game, code, session!.token, true)),
    decline: () => run(() => api.rematchRespond(game, code, session!.token, false), "已拒绝，本局保持原样"),
    // 发起方主动取消，或接收方退出房间（放弃再赛）。
    leave: () => run(() => api.rematchLeave(game, code, session!.token)),
  };
}
