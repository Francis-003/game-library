import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DreamerBox, DreamerOffer, DreamerResult } from "@/lib/types";

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

function gainText(value: number): string {
  if (value > 0) return `+${value.toFixed(2)}`;
  return value.toFixed(2);
}

export function ResultPanel({ result, tierName, role, boxes, offers, onRematch }: {
  result: DreamerResult;
  tierName: string;
  role: "player" | "banker";
  boxes: DreamerBox[];
  offers: DreamerOffer[];
  onRematch: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const myGain = role === "player" ? result.playerGain : result.bankerGain;
  const otherGain = role === "player" ? result.bankerGain : result.playerGain;
  const otherRole = role === "player" ? "银行家" : "玩家";

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-5 text-center">
        <div className="text-5xl">{result.dealt ? "🤝" : "🎉"}</div>
        <h2 className="text-xl font-bold">{result.dealt ? "成交！" : "开箱揭晓！"}</h2>
        <div>
          <p className="text-sm text-muted-foreground">本局你的净收益</p>
          <p className={`text-4xl font-bold ${myGain >= 0 ? "text-primary" : "text-destructive"}`}>
            {gainText(myGain)} 元
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {myGain > 0 ? "你赚了" : myGain < 0 ? "你赔了" : "不赚不赔"}
            · {otherRole} {gainText(otherGain)} 元
          </p>
        </div>
        <div className="space-y-1 text-sm text-muted-foreground">
          {result.dealt ? (
            <p>
              第 {offers.find(o => o.decision === "deal")?.roundNo ?? "?"} 轮以 {result.dealAmount?.toFixed(2)} 元
              {role === "player" ? "接受买断" : "买断幸运箱"}；幸运箱 {result.luckyBox} 号里是 {result.luckyAmount?.toFixed(2)} 元。
            </p>
          ) : (
            <>
              <p>幸运箱 {result.luckyBox} 号：{result.luckyAmount?.toFixed(2)} 元</p>
              <p>最终持有 {result.finalBoxNo} 号箱：{result.finalAmount?.toFixed(2)} 元</p>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{tierName}</p>
      </div>

      <Button variant="outline" onClick={() => setShowDetail(v => !v)} className="w-full">
        {showDetail ? "收起详情" : "查看所有箱子与报价历史"}
      </Button>

      {showDetail && (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-semibold">所有箱子面额</h3>
            <div className="grid grid-cols-5 gap-2">
              {boxes.map(box => (
                <div
                  key={box.no}
                  className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-xs ${
                    box.no === result.luckyBox ? "border-amber-400 bg-amber-50" : "bg-muted/30"
                  }`}
                >
                  <span className="font-mono font-semibold">{box.no}</span>
                  <span className="mt-0.5 text-[10px] text-muted-foreground">{box.amount?.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">⭐ 标记的是你的幸运箱；开出的金额已作废，未开的箱子终局全部揭开。</p>
          </div>
          <OfferTimeline offers={offers} />
        </div>
      )}

      <Button onClick={onRematch} className="w-full">再来一局</Button>
    </div>
  );
}
