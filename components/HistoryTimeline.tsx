import type { HistoryEntry, Seat } from "@/lib/types";

type Props = {
  seat: Seat;
  history: HistoryEntry[];
  myNick: string;
  opponentNick: string;
};

// 服务端按席位列返回 wordA/wordB，这里换算成“我 / TA”，避免双方看到的方向不一致。
export function HistoryTimeline({ seat, history, myNick, opponentNick }: Props) {
  if (!history.length) return null;
  const mine = (entry: HistoryEntry) => (seat === "a" ? entry.wordA : entry.wordB);
  const theirs = (entry: HistoryEntry) => (seat === "a" ? entry.wordB : entry.wordA);
  return (
    <section className="rounded-xl border bg-card">
      <h2 className="border-b px-4 py-2.5 text-xs text-muted-foreground">已经出现过的词</h2>
      <ol className="divide-y">
        {history.map(entry => (
          <li key={entry.round} className="flex items-center gap-3 px-4 py-3 text-sm">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">第 {entry.round} 轮</span>
            <span className="min-w-0 flex-1 truncate" title={myNick}>{mine(entry)}</span>
            <span className={entry.matched ? "text-primary" : "text-muted-foreground/60"} aria-hidden>
              {entry.matched ? "＝" : "≠"}
            </span>
            <span className="min-w-0 flex-1 truncate text-right" title={opponentNick}>{theirs(entry)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
