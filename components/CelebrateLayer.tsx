import { Button } from "@/components/ui/button";

type Props = {
  winRound: number;
  onDismiss: () => void;
  onRematch: () => void;
  busy: boolean;
};

export function CelebrateLayer({ winRound, onDismiss, onRematch, busy }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm animate-in fade-in duration-300 motion-reduce:animate-none">
      <div className="hero-warm w-full max-w-sm rounded-3xl border border-primary/30 p-8 text-center shadow-soft animate-in zoom-in-95 duration-300 motion-reduce:animate-none">
        <p className="text-sm tracking-widest text-primary-foreground/70">同词遇见</p>
        <p className="mt-4 text-4xl leading-tight font-bold text-white drop-shadow-sm">遇见了</p>
        <p className="mt-3 text-sm leading-relaxed text-primary-foreground/85">
          第 {winRound} 轮，你们说出了同一个词。
        </p>
        <div className="mt-7 grid gap-2">
          <Button size="lg" variant="secondary" className="rounded-xl" disabled={busy} onClick={onRematch}>
            {busy ? "正在开新局" : "再来一局"}
          </Button>
          <Button variant="ghost" className="rounded-xl text-primary-foreground hover:bg-white/15 hover:text-white" onClick={onDismiss}>
            看看这一路的词
          </Button>
        </div>
      </div>
    </div>
  );
}
