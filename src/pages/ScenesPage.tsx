import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, isSeatError, message } from "@/lib/api";
import { forgetSession, loadSession, type Session } from "@/lib/session";
import type { SceneLibrary } from "@/lib/types";
import { toast } from "sonner";

function groupByCategory(builtin: SceneLibrary["builtin"]) {
  const groups = new Map<string, string[]>();
  for (const scene of builtin) {
    const list = groups.get(scene.category) ?? [];
    list.push(scene.name);
    groups.set(scene.category, list);
  }
  return [...groups.entries()];
}

export function ScenesPage() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [library, setLibrary] = useState<SceneLibrary | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (active: Session, signal?: AbortSignal) => {
    try {
      setLibrary(await api.scenes(active.code, active.token, signal));
      setError(null);
    } catch (caught) {
      if (signal?.aborted) return;
      if (isSeatError(caught)) {
        forgetSession(active.code);
        setSession(null);
        return;
      }
      setError(message(caught));
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void load(session, controller.signal);
    return () => controller.abort();
  }, [session, load]);

  const groups = useMemo(() => (library ? groupByCategory(library.builtin) : []), [library]);
  const enabledCustom = library?.custom.filter(scene => scene.enabled).length ?? 0;

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || !session) return;
    setBusy(true);
    try {
      await api.addScene(session.code, session.token, trimmed);
      setName("");
      toast.success("已加入你们共用的场景库");
      await load(session);
    } catch (caught) {
      toast.error(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    if (!session || !library) return;
    setBusy(true);
    try {
      await api.toggleScene(session.code, session.token, id, enabled);
      setLibrary({ ...library, custom: library.custom.map(row => (row.id === id ? { ...row, enabled } : row)) });
    } catch (caught) {
      toast.error(message(caught));
      await load(session);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <a href="#/g/tongci" className="text-sm text-muted-foreground underline-offset-4 hover:underline">回游戏</a>
        <h1 className="text-xl font-semibold tracking-tight">场景库</h1>
      </header>

      {!session && (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          场景库跟着某一局走：先开一局或用口令进来，就能在这里添加你们自己的场景。
        </p>
      )}

      {session && error && (
        <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => void load(session)}>重新读取</Button>
        </div>
      )}

      {session && !library && !error && (
        <div className="flex items-center gap-2 pt-10 text-sm text-muted-foreground">
          <Spinner className="size-4" /> 正在读取场景库
        </div>
      )}

      {session && library && (
        <>
          <p className="text-sm text-muted-foreground">
            第 1 轮从这里抽一个场景：内置 {library.builtin.length} 个，你们自己加的 {enabledCustom} 个可用。
          </p>

          <section className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-medium">添加一个场景</h2>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 12))}
                placeholder="例如：周末的阳台"
                maxLength={12}
                className="h-11 min-w-0 flex-1"
                aria-label="新场景名称"
              />
              <Button className="h-11 shrink-0 rounded-lg px-4" disabled={busy || !name.trim()} onClick={() => void add()}>
                添加
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">12 字以内。两个人共享同一份自定义场景，不能和内置重名。</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">你们添加的</h2>
            {library.custom.length === 0 && (
              <p className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">还没有添加过。</p>
            )}
            {library.custom.map(row => (
              <div key={row.id} className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                <Switch checked={row.enabled} disabled={busy} onCheckedChange={value => void toggle(row.id, value)} aria-label={`${row.name} 是否可用`} />
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium">内置场景</h2>
            {groups.map(([category, names]) => (
              <div key={category} className="rounded-lg border bg-card p-4">
                <p className="text-xs text-muted-foreground">{category}</p>
                <p className="mt-2 text-sm leading-7">{names.join(" · ")}</p>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
