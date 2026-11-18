import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Scene } from "@/lib/types";

export function SceneCard({ scene, round }: { scene: Scene | null; round: number }) {
  if (!scene) {
    return (
      <Card className="border-dashed bg-muted/40">
        <CardContent className="px-5 py-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            第 {round} 轮没有场景提示。只能看着前面已经出现过的词，猜 TA 这一轮会说什么。
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-primary/25 bg-accent">
      <CardContent className="px-5 py-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge className="rounded-full">第 1 轮 · 场景</Badge>
          {scene.source === "custom" ? <span>来自你们自己添加的场景</span> : null}
        </div>
        <p className="mt-3 text-3xl leading-snug font-semibold tracking-tight">{scene.text}</p>
        <p className="mt-2 text-sm text-muted-foreground">看到这个场景，你脑子里第一个冒出来的词是什么？</p>
      </CardContent>
    </Card>
  );
}
