import { cn } from "@/lib/utils";
import type { DreamerBox } from "@/lib/types";

export function BoxGrid({ boxes, luckyBox, role, phase, openingsLeft, onBoxClick }: {
  boxes: DreamerBox[];
  luckyBox: number | null;
  role: "player" | "banker";
  phase: string;
  openingsLeft: number;
  onBoxClick: (no: number) => void;
}) {
  const cols = boxes.length <= 10 ? "grid-cols-5" : boxes.length <= 16 ? "grid-cols-4" : "grid-cols-6";
  const canPick = role === "player" && phase === "pick_lucky";
  const canOpen = role === "player" && phase === "opening" && openingsLeft > 0;

  return (
    <div className={cn("grid gap-2", cols)}>
      {boxes.map(box => {
        const isLucky = box.no === luckyBox;
        const clickable = canPick || (canOpen && !box.opened && !isLucky);
        return (
          <button
            key={box.no}
            disabled={!clickable}
            onClick={() => onBoxClick(box.no)}
            className={cn(
              "relative flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition-colors",
              box.opened && "border-muted bg-muted/40 text-muted-foreground",
              !box.opened && clickable && "border-primary/40 bg-card hover:border-primary hover:bg-primary/5",
              !box.opened && !clickable && "bg-card",
              isLucky && !box.opened && "ring-2 ring-amber-400",
            )}
          >
            {isLucky && !box.opened && <span className="absolute -top-1 -right-1 text-xs">⭐</span>}
            <span className="font-mono text-base font-semibold">{box.no}</span>
            {box.amount !== null && (
              <span className="mt-0.5 text-[10px] text-muted-foreground">{box.amount} 元</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
