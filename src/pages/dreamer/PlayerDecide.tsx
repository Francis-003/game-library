import { Button } from "@/components/ui/button";

export function PlayerDecide({ amount, line, busy, onDecide, final }: {
  amount: number;
  line: string | null;
  busy: boolean;
  onDecide: (deal: boolean) => void;
  final?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="text-center">
        <p className="text-xs text-muted-foreground">{final ? "银行家的最终报价" : "银行家报价"}</p>
        <p className="text-3xl font-bold text-primary">{amount.toFixed(2)} 元</p>
        {line && <p className="mt-2 text-sm italic text-muted-foreground">“{line}”</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => onDecide(true)} disabled={busy} className="w-full">成交 Dealt</Button>
        <Button onClick={() => onDecide(false)} disabled={busy} variant="outline" className="w-full">
          {final ? "不卖，开箱" : "不卖 No Deal"}
        </Button>
      </div>
      {final && <p className="text-center text-xs text-muted-foreground">拒绝后可保留幸运箱，或和最后一个箱子交换。</p>}
    </div>
  );
}

export function FinalPickChoice({ busy, onPick }: {
  busy: boolean;
  onPick: (choice: "keep" | "swap") => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-50 p-4">
      <h3 className="text-center font-semibold">最后的选择</h3>
      <p className="text-center text-xs text-muted-foreground">你拒绝了最终报价。现在可以保留幸运箱，或和最后一个公共箱交换。</p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => onPick("keep")} disabled={busy} variant="outline" className="w-full">保留幸运箱</Button>
        <Button onClick={() => onPick("swap")} disabled={busy} className="w-full">交换箱子</Button>
      </div>
    </div>
  );
}
