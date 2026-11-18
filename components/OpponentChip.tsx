import { cn } from "@/lib/utils";
import type { RoomView } from "@/lib/types";

export function OpponentChip({ view }: { view: RoomView }) {
  const name = view.opponentNick || "对方";
  // 三态全部来自服务端布尔，不用计时器猜对方是否提交。
  const state = view.status === "waiting" ? "还没加入" : view.opponentSealed ? "已经写好" : "正在想";
  const dot = view.status === "waiting" ? "bg-muted-foreground/40"
    : view.opponentSealed ? "bg-primary"
      : "bg-primary/50 animate-pulse motion-reduce:animate-none";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm shadow-soft">
      <span className={cn("size-2 rounded-full", dot)} aria-hidden />
      <span className="truncate">{name}</span>
      <span className="text-muted-foreground">{state}</span>
    </span>
  );
}
