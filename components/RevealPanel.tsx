import { cn } from "@/lib/utils";
import type { RoomView } from "@/lib/types";

function WordPane({ label, word, tone }: { label: string; word: string; tone: "mine" | "theirs" | "same" }) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-xl border p-4 text-center",
        tone === "same" && "border-primary/40 bg-primary/10",
        tone === "mine" && "bg-accent",
        tone === "theirs" && "bg-secondary",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl leading-snug font-semibold break-words">{word}</p>
    </div>
  );
}

// 只有服务端把 opponentWord 放进响应时才会渲染这个面板：前端没有任何途径自行还原对方的词。
export function RevealPanel({ view }: { view: RoomView }) {
  const matched = view.matched === true;
  const opponentWord = view.opponentWord ?? "";
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <WordPane label={view.myNick || "你"} word={view.myWord ?? ""} tone={matched ? "same" : "mine"} />
        <WordPane label={view.opponentNick || "对方"} word={opponentWord} tone={matched ? "same" : "theirs"} />
      </div>
      <p className={cn("text-center text-sm", matched ? "text-primary" : "text-muted-foreground")}>
        {matched
          ? `第 ${view.winRound ?? view.round} 轮，你们说出了同一个词。`
          : "还没遇上。下一轮没有场景提示，只能靠这两个词去猜 TA。"}
      </p>
    </div>
  );
}
