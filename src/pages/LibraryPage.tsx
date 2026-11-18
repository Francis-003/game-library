import { games } from "../games";
import { ChevronRight } from "lucide-react";

// 游戏库 Tab：列表来自 src/games.ts 注册表，上新游戏注册即可出现。
export function LibraryPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-5 pt-6 pb-32">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">游戏库</h1>
        <p className="text-sm text-muted-foreground">
          一些可以和朋友一起玩的小游戏，会陆续上新。
        </p>
      </header>

      <section className="space-y-3">
        {games.map(game => (
          <a
            key={game.id}
            href={`#/g/${game.id}`}
            className="pressable block rounded-2xl border bg-card p-4 shadow-soft hover:bg-accent/40"
          >
            <div className="flex items-center gap-3.5">
              <div
                className="hero-warm flex size-14 shrink-0 items-center justify-center rounded-2xl text-2xl"
                aria-hidden
              >
                {game.emoji}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold tracking-tight">{game.name}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{game.meta}</span>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{game.tagline}</p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground/70" />
            </div>
          </a>
        ))}
      </section>

      <footer className="mt-auto rounded-2xl bg-muted/50 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          上新中：写好页面，在 <code className="font-mono">src/games.ts</code> 注册即可出现在这里。
        </p>
      </footer>
    </main>
  );
}