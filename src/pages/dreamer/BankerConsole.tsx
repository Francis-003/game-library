import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BankerConsole({ base, busy, onOffer, disabled }: {
  base: number | null;
  busy: boolean;
  onOffer: (amount?: number, line?: string) => void;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [line, setLine] = useState("");

  function send(custom: boolean) {
    const parsed = Number.parseFloat(amount);
    const value = custom && Number.isFinite(parsed) ? parsed : undefined;
    onOffer(value, line.trim() || undefined);
  }

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">🏦 银行家报价台</h3>
        {base !== null && <span className="text-xs text-muted-foreground">参考价 {base.toFixed(2)} 元</span>}
      </div>
      {base !== null && (
        <p className="text-xs text-muted-foreground">可在参考价 ±20% 内讲价，留空则按参考价。</p>
      )}
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          value={amount}
          onChange={event => setAmount(event.target.value)}
          placeholder={base !== null ? base.toFixed(2) : "报价金额"}
          className="h-11 flex-1"
          aria-label="报价金额"
        />
        <Button onClick={() => send(true)} disabled={busy || disabled} variant="outline">按此价</Button>
      </div>
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
