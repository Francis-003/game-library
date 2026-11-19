import { ArrowLeft, Copy, Link2, BookOpen } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyText, inviteUrl } from "@/lib/clipboard";
import type { RoomView } from "@/lib/types";
import { toast } from "sonner";

type Props = {
  view: RoomView;
  busy: boolean;
  onFinish: () => void;
  // 离开房间：若有进行中的再赛邀请，通知对方（best-effort）。
  onLeave: () => void;
};

export function RoomHeader({ view, busy, onFinish, onLeave }: Props) {
  const over = view.status === "matched" || view.status === "ended";

  async function copy(what: "code" | "link") {
    const value = what === "code" ? view.code : inviteUrl(view.code);
    const ok = await copyText(value);
    toast[ok ? "success" : "error"](ok ? (what === "code" ? "口令已复制" : "邀请链接已复制") : "复制失败，请手动抄写口令");
  }

  return (
    <header className="sticky top-0 z-20 border-b bg-background/92 backdrop-blur">
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-2.5">
        <a
          href="#/g/tongci"
          aria-label="返回游戏首页"
          onClick={onLeave}
          className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-accent active:scale-95"
        >
          <ArrowLeft className="size-5" />
        </a>
        <span className="shrink-0 text-sm font-semibold">同词遇见</span>
        <Badge variant="outline" className="rounded-lg font-mono text-sm tracking-[0.2em]">{view.code}</Badge>
        <Button variant="ghost" size="icon-xs" aria-label="复制口令" onClick={() => void copy("code")}>
          <Copy />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="复制邀请链接" onClick={() => void copy("link")}>
          <Link2 />
        </Button>
        <div className="flex-1" />
        <a
          href="#/g/tongci/scenes"
          aria-label="场景库"
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
        >
          <BookOpen className="size-5" />
        </a>
        {!over && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" disabled={busy}>
                结束
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-[92vw] rounded-2xl sm:max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle>结束这一局？</AlertDialogTitle>
                <AlertDialogDescription>
                  两个人都没说完的词不会被揭开。结束后可以用同一个口令再开一局。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>再想想</AlertDialogCancel>
                <AlertDialogAction onClick={onFinish}>结束本局</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </header>
  );
}
