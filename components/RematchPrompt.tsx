import { Button } from "@/components/ui/button";
import type { RematchInfo } from "@/lib/types";

// 再来一局的共享提示卡：发起方等待、接收方确认/拒绝、被拒绝提示。
// 两个游戏的结果页都渲染它，样式与交互只有这一份。
export function RematchPrompt({
  info,
  busy,
  onAccept,
  onDecline,
  onCancel,
  onDismiss,
}: {
  info: RematchInfo;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  if (info.status === "waiting") {
    return (
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center shadow-soft">
        <div className="flex items-center justify-center gap-2 text-base font-semibold">
          <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden />
          已邀请 TA 再来一局
        </div>
        <p className="mt-2 text-sm text-muted-foreground">等对方确认后，两人才会一起进入新的一局。</p>
        <Button variant="ghost" size="sm" className="mt-3" disabled={busy} onClick={onCancel}>
          取消邀请
        </Button>
      </section>
    );
  }

  if (info.status === "incoming") {
    return (
      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center shadow-soft">
        <p className="text-base font-semibold">{info.fromName || "对方"} 想再来一局</p>
        <p className="mt-2 text-sm text-muted-foreground">你确认后，双方会同时进入新的一局。</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" disabled={busy} onClick={onDecline}>不玩了</Button>
          <Button disabled={busy} onClick={onAccept}>{busy ? "确认中…" : "再来一局"}</Button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-card p-5 text-center shadow-soft">
      <p className="text-sm font-medium">对方这局不来了</p>
      <p className="mt-1 text-xs text-muted-foreground">本局保持原样，你可以再发起一次或返回游戏库。</p>
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" disabled={busy} onClick={onDismiss}>知道了</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>重新邀请</Button>
      </div>
    </section>
  );
}
