import { Gamepad2, Home, UserRound } from "lucide-react";
import { usePresence } from "@/hooks/usePresence";
import { cn } from "@/lib/utils";

// 三个主 Tab 的底部导航：只在 Tab 壳层挂载，房间/游戏页为沉浸式全屏。
export type TabKey = "home" | "games" | "me";

type TabItem = { key: TabKey; label: string; icon: typeof Home; href: string };

export function BottomNav({ active }: { active: TabKey }) {
  const { snapshot } = usePresence();
  const inviteCount = snapshot?.invites.length ?? 0;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-md justify-around px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)] items-stretch">
        {TABS.map(tab => renderTab(tab, active, inviteCount))}
      </div>
    </nav>
  );
}

const TABS: TabItem[] = [
  { key: "home", label: "首页", icon: Home, href: "#/" },
  { key: "games", label: "游戏库", icon: Gamepad2, href: "#/games" },
  { key: "me", label: "我的", icon: UserRound, href: "#/me" },
];

function renderTab(tab: TabItem, active: TabKey, inviteCount: number) {
  const Icon = tab.icon;
  const on = tab.key === active;
  return (
    <a
      key={tab.key}
      href={tab.href}
      aria-current={on ? "page" : undefined}
      className="flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-3 py-1 transition-transform active:scale-95"
    >
      <span className="relative">
        <Icon
          strokeWidth={on ? 2.4 : 2}
          className={cn("size-6 transition-colors", on ? "text-primary" : "text-muted-foreground")}
        />
        {tab.key === "home" && inviteCount > 0 && (
          <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
            {inviteCount > 9 ? "9+" : inviteCount}
          </span>
        )}
      </span>
      <span className={cn("text-[11px] leading-tight", on ? "font-semibold text-primary" : "text-muted-foreground")}>
        {tab.label}
      </span>
    </a>
  );
}