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
      <div className="w-full max-w-sm rounded-2xl border border-primary/30 bg-card p-8 text-center shadow-lg animate-in zoom-in-95 duration-300 motion-reduce:animate-none">
        <p className="text-sm tracking-widest text-muted-foreground">同词遇见</p>
        <p className="mt-4 text-4xl leading-tight font-semibold text-primary">遇见了</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          第 {winRound} 轮，你们说出了同一个词。
        </p>
        <div className="mt-7 grid gap-2">
          <Button size="lg" className="rounded-lg" disabled={busy} onClick={onRematch}>
            {busy ? "正在开新局" : "再来一局"}
          </Button>
          <Button variant="ghost" className="rounded-lg" onClick={onDismiss}>
            看看这一路的词
          </Button>
        </div>
      </div>
    </div>
  );
}
