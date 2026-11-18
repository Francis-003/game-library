import { Button } from "@/components/ui/button";
import type { DreamerOffer, DreamerResult } from "@/lib/types";

export function OfferTimeline({ offers }: { offers: DreamerOffer[] }) {
  if (!offers.length) return null;
  return (
    <div className="space-y-1.5 rounded-xl border bg-card p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">报价记录</h3>
      {offers.map(offer => (
        <div key={offer.roundNo} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">第 {offer.roundNo} 轮</span>
          <span className="font-medium">{offer.amount.toFixed(2)} 元</span>
          <span className="text-xs text-muted-foreground">
            {offer.decision === "deal" ? "✅ 成交" : offer.decision === "no_deal" ? "❌ 不卖" : "待决定"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ResultPanel({ result, tierName, onRematch }: {
  result: DreamerResult;
  tierName: string;
  onRematch: () => void;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
      <div className="text-5xl">{result.dealt ? "🤝" : "🎉"}</div>
      <h2 className="text-xl font-bold">{result.dealt ? "成交！" : "开箱揭晓！"}</h2>
      <div>
        <p className="text-sm text-muted-foreground">{result.dealt ? "你卖掉了幸运箱，赢得" : "最终赢得"}</p>
        <p className="text-4xl font-bold text-primary">{result.wonAmount.toFixed(2)} 元</p>
      </div>
      {!result.dealt && (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>幸运箱 {result.luckyBox} 号：{result.luckyAmount?.toFixed(2)} 元</p>
          <p>最终选择：{result.finalBoxNo} 号箱</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tierName}</p>
      <Button onClick={onRematch} className="w-full">再来一局</Button>
    </div>
  );
}
