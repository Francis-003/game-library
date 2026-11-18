import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BankerConsole({ base, averageLeft, busy, onOffer, disabled }: {
  base: number | null;
  averageLeft: number | null;
  busy: boolean;
  onOffer: (amount?: number, line?: string) => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 两条路径必须分开：留空就是「按参考价」，自定义价留空不能悄悄退化成参考价，
  // 否则银行家以为自己没出价，实际已经把参考价报出去了。
  function send(custom: boolean) {
    if (!custom) {
      onOffer(undefined, line.trim() || undefined);
      return;
    }
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("先填一个不小于 0 的金额，或者直接用下面的参考价按钮。");
      return;
    }
    setError(null);
    onOffer(Math.round(parsed * 100) / 100, line.trim() || undefined);
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">🏦 银行家报价台</h3>
        {averageLeft !== null && (
          <span className="text-xs text-muted-foreground">未翻均值 {averageLeft.toFixed(2)} 元</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">报价不限金额，随便开价；输入框上方显示的是没翻出来的所有面额的均值。</p>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={event => { setAmount(event.target.value); setError(null); }}
          placeholder={averageLeft !== null ? `未翻均值 ${averageLeft.toFixed(2)}` : "报价金额"}
          className="h-11 flex-1"
          aria-label="报价金额"
        />
        <Button onClick={() => send(true)} disabled={busy || disabled} variant="outline">按此价</Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Input
        value={line}
        onChange={event => setLine(event.target.value.slice(0, 60))}
        placeholder="加一句心理战（选填）"
        className="h-10"
        aria-label="心理战台词"
      />
      <Button onClick={() => send(false)} disabled={busy || disabled} className="w-full">
        {busy ? "发送中…" : base !== null ? `按参考价 ${base.toFixed(2)} 报价` : "报价"}
      </Button>
    </div>
  );
}
