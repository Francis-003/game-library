import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { DreamerBox, DreamerOffer, DreamerResult, DreamerRole } from "@/lib/types";

function DecisionMark({ decision }: { decision: "deal" | "no_deal" | null }) {
  if (decision === "deal") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-primary">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 8 3.5 3.5L13 5" />
        </svg>
        成交
      </span>
    );
  }
  if (decision === "no_deal") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
        不卖
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">待决定</span>;
}

export function OfferTimeline({ offers }: { offers: DreamerOffer[] }) {
  if (!offers.length) return null;
  return (
    <div className="space-y-1.5 rounded-xl border bg-card p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">报价记录</h3>
      {offers.map(offer => (
        <div key={offer.roundNo} className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">第 {offer.roundNo} 轮</span>
          <span className="font-medium">{offer.amount.toFixed(2)} 元</span>
          <DecisionMark decision={offer.decision} />
        </div>
      ))}
    </div>
  );
}

function money(value: number): string {
  return `${value.toFixed(2)} 元`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

/** 单一真源：净收益 = P − V。双方共用，符号相反，绝不各算一套。 */
function netGain(result: DreamerResult, role: DreamerRole): number {
  return role === "player" ? result.playerGain : result.bankerGain;
}

/* ---------------- 角色插画（纯 SVG，无 emoji） ---------------- */

function PlayerCrest() {
  return (
    <svg viewBox="0 0 64 64" className="size-12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 30h24l-3 20H23z" />
      <path d="M25 30v-6a7 7 0 0 1 14 0v6" />
      <path d="M26 38h12" />
      <path d="M32 34v8" />
    </svg>
  );
}

function BankerCrest() {
  return (
    <svg viewBox="0 0 64 64" className="size-12" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 26 32 16l18 10" />
      <path d="M18 26v18M46 26v18M26 26v18M38 26v18" />
      <path d="M12 48h40" />
    </svg>
  );
}

/* ---------------- 共用：P / V 计算明细 ---------------- */

function GainBreakdown({ result }: { result: DreamerResult }) {
  const p = result.p;
  const v = result.luckyAmount;
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold">净收益怎么算</h3>
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">银行家买断价 P</span>
          <span className="font-medium tabular-nums">{money(p)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">幸运箱 {result.luckyBox} 号面额 V</span>
          <span className="font-medium tabular-nums">{money(v)}</span>
        </div>
        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-muted-foreground">玩家净收益 P − V</span>
          <span className="font-semibold tabular-nums">{signed(result.playerGain)} 元</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">银行家净收益 V − P</span>
          <span className="font-semibold tabular-nums">{signed(result.bankerGain)} 元</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {result.dealt ? "本局中途成交，买断价 P 即成交价。" : "本局开箱到底，买断价 P 取最后一轮银行家报价。"}
      </p>
    </div>
  );
}

function AllBoxes({ result, boxes }: { result: DreamerResult; boxes: DreamerBox[] }) {
  return (
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
      <p className="mt-2 text-xs text-muted-foreground">高亮的是幸运箱；开出的金额已作废，未开的箱子终局全部揭开。</p>
    </div>
  );
}

/* ---------------- 玩家视图：拿钱的人 ---------------- */

function PlayerResult({ result, offers, boxes, onRematch }: {
  result: DreamerResult;
  offers: DreamerOffer[];
  boxes: DreamerBox[];
  onRematch: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const gain = netGain(result, "player");
  const won = gain > 0;
  const lost = gain < 0;
  const headline = won ? "你赚到了" : lost ? "这局你赔了" : "不赚不赔";
  const note = won
    ? `买断价 ${money(result.p)} 高于幸运箱 ${money(result.luckyAmount)}，差额落进你的口袋。`
    : lost
      ? `买断价 ${money(result.p)} 低于幸运箱 ${money(result.luckyAmount)}，你把差额赔给了银行家。`
      : `买断价与幸运箱面额都是 ${money(result.p)}，这一局打平。`;

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <PlayerCrest />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">玩家 · 你的净收益</p>
          <h2 className="mt-1 text-2xl font-bold text-foreground">{headline}</h2>
        </div>
        <p className={`text-5xl font-bold tabular-nums ${won ? "text-primary" : lost ? "text-destructive" : "text-foreground"}`}>
          {signed(gain)} <span className="text-2xl">元</span>
        </p>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">{note}</p>
        <div className="space-y-1 border-t pt-3 text-sm text-muted-foreground">
          <p>
            {result.dealt
              ? `第 ${offers.find(o => o.decision === "deal")?.roundNo ?? "?"} 轮以 ${money(result.p)} 接受买断`
              : `开箱到底，最后一轮报价 ${money(result.p)}`}
            ；幸运箱 {result.luckyBox} 号里是 {money(result.luckyAmount)}。
          </p>
          {!result.dealt && result.finalBoxNo != null && (
            <p>最终持有 {result.finalBoxNo} 号箱：{money(result.finalAmount ?? 0)}</p>
          )}
        </div>
      </section>

      <GainBreakdown result={result} />

      <Button variant="outline" onClick={() => setShowDetail(v => !v)} className="w-full">
        {showDetail ? "收起详情" : "查看所有箱子与报价历史"}
      </Button>
      {showDetail && (
        <div className="space-y-3">
          <AllBoxes result={result} boxes={boxes} />
          <OfferTimeline offers={offers} />
        </div>
      )}
      <Button onClick={onRematch} className="w-full">再来一局（等对方确认）</Button>
    </div>
  );
}

/* ---------------- 银行家视图：收箱的人 ---------------- */

function BankerResult({ result, offers, boxes, onRematch }: {
  result: DreamerResult;
  offers: DreamerOffer[];
  boxes: DreamerBox[];
  onRematch: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const gain = netGain(result, "banker");
  const won = gain > 0;
  const lost = gain < 0;
  const headline = won ? "这局你赚了" : lost ? "这局你赔了" : "不赚不赔";
  const note = won
    ? `买断价 ${money(result.p)} 低于幸运箱 ${money(result.luckyAmount)}，你用更少的钱收下了箱子，净赚差额。`
    : lost
      ? `买断价 ${money(result.p)} 高于幸运箱 ${money(result.luckyAmount)}，你多付了差额。`
      : `买断价与幸运箱面额都是 ${money(result.p)}，这一局打平。`;

  return (
    <div className="space-y-4">
      <section className="relative space-y-3 overflow-hidden rounded-2xl border bg-slate-900 p-6 text-center text-slate-100">
        <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full border border-white/10" />
        <div className="pointer-events-none absolute -bottom-10 -left-6 size-28 rounded-full border border-white/10" />
        <div className="relative mx-auto flex size-16 items-center justify-center rounded-full bg-white/10 text-slate-100">
          <BankerCrest />
        </div>
        <div className="relative">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-300/80">银行家 · 你的净收益</p>
          <h2 className="mt-1 text-2xl font-bold">{headline}</h2>
        </div>
        <p className={`relative text-5xl font-bold tabular-nums ${won ? "text-emerald-300" : lost ? "text-rose-300" : "text-slate-100"}`}>
          {signed(gain)} <span className="text-2xl">元</span>
        </p>
        <p className="relative mx-auto max-w-xs text-sm leading-relaxed text-slate-300">{note}</p>
        <div className="relative space-y-1 border-t border-white/10 pt-3 text-sm text-slate-300">
          <p>
            {result.dealt
              ? `第 ${offers.find(o => o.decision === "deal")?.roundNo ?? "?"} 轮以 ${money(result.p)} 买断幸运箱`
              : `开箱到底，你的最后一轮报价 ${money(result.p)}`}
            ；幸运箱 {result.luckyBox} 号里是 {money(result.luckyAmount)}。
          </p>
        </div>
      </section>

      <GainBreakdown result={result} />

      <Button variant="outline" onClick={() => setShowDetail(v => !v)} className="w-full">
        {showDetail ? "收起详情" : "查看所有箱子与报价历史"}
      </Button>
      {showDetail && (
        <div className="space-y-3">
          <AllBoxes result={result} boxes={boxes} />
          <OfferTimeline offers={offers} />
        </div>
      )}
      <Button onClick={onRematch} className="w-full">再来一局（等对方确认）</Button>
    </div>
  );
}

/* ---------------- 入口：按角色分发到两套不同的结果页 ---------------- */

export function ResultPanel({ result, tierName, role, boxes, offers, onRematch }: {
  result: DreamerResult;
  tierName: string;
  role: "player" | "banker";
  boxes: DreamerBox[];
  offers: DreamerOffer[];
  onRematch: () => void;
}) {
  return (
    <div className="space-y-3">
      {role === "player" ? (
        <PlayerResult result={result} offers={offers} boxes={boxes} onRematch={onRematch} />
      ) : (
        <BankerResult result={result} offers={offers} boxes={boxes} onRematch={onRematch} />
      )}
      <p className="text-center text-xs text-muted-foreground">{tierName}</p>
    </div>
  );
}
