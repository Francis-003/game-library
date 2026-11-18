import { useCallback, useEffect, useRef, useState } from "react";
import { api, isSeatError, message } from "../lib/api";
import type { Session } from "../lib/session";
import type { DreamerView } from "../lib/types";

const IDLE_SLOW_AFTER = 60_000;
const MAX_INTERVAL = 6_000;
// 终局后慢速轮询：对方点「再来一局」是原对局就地重开，口令不变，
// 只有继续轮询才能看到 status 从 ended 变回 playing。
const TERMINAL_INTERVAL = 3_000;

// 频率按 phase + 角色分级：轮到操作时最灵敏，等待对方时放慢；终局放慢到 ~3s 等重开。
function nextInterval(view: DreamerView | null, role: string | null, idleFor: number): number {
  if (!view) return 1200;
  if (view.phase === "ended") return TERMINAL_INTERVAL;
  let base: number;
  if (view.status === "waiting") base = 1500;
  else if (view.phase === "pick_lucky" || view.phase === "opening") base = 3000;
  else if (
    (view.phase === "offer" || view.phase === "final_offer") && role === "banker"
    || (view.phase === "decide" || view.phase === "final_decide" || view.phase === "final_pick") && role === "player"
  ) base = 1200;
  else base = 2000;
  return idleFor > IDLE_SLOW_AFTER ? Math.min(base * 2, MAX_INTERVAL) : base;
}

export function useDreamer(session: Session | null) {
  const [view, setView] = useState<DreamerView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const viewRef = useRef<DreamerView | null>(null);
  const changedRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  viewRef.current = view;

  const refresh = useCallback(async (): Promise<DreamerView | null> => {
    if (!session) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const fresh = await api.dreamerState(session.code, session.token, controller.signal);
      if (controller.signal.aborted) return null;
      if (fresh.rev !== viewRef.current?.rev) changedRef.current = Date.now();
      setView(fresh);
      setNotice(null);
      return fresh;
    } catch (error) {
      if (controller.signal.aborted) return null;
      if (isSeatError(error)) {
        setLost(true);
        return null;
      }
      setNotice(message(error));
      return null;
    }
  }, [session]);

  useEffect(() => {
    setView(null);
    setLost(false);
    setNotice(null);
    changedRef.current = Date.now();
    if (!session) return;

    let stopped = false;
    const tick = async (immediate = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (stopped || (!immediate && document.hidden)) return;
      const fresh = await refresh();
      if (stopped || document.hidden) return;
      const role = viewRef.current?.role ?? null;
      const delay = nextInterval(fresh ?? viewRef.current, role, Date.now() - changedRef.current);
      if (delay === null) return;
      timerRef.current = setTimeout(tick, delay);
    };
    const onVisible = () => {
      if (document.hidden) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        return;
      }
      changedRef.current = Date.now();
      void tick(true);
    };
    void tick(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [session, refresh]);

  const act = useCallback(async (run: () => Promise<DreamerView>) => {
    setBusy(true);
    try {
      const fresh = await run();
      changedRef.current = Date.now();
      setView(fresh);
      setNotice(null);
      return fresh;
    } catch (error) {
      if (isSeatError(error)) {
        setLost(true);
        return null;
      }
      // 写请求被拒（相位已过、已经报过价等）必须让人看见原因，
      // 否则界面只是「点了没反应」。先同步到最新状态，再挂上提示。
      const text = message(error);
      await refresh();
      setNotice(text);
      return null;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return {
    view,
    notice,
    lost,
    busy,
    refresh,
    act,
    actions: session
      ? {
        pickLucky: (boxNo: number) => act(() => api.dreamerPickLucky(session.code, session.token, boxNo)),
        open: (boxNo: number) => act(() => api.dreamerOpen(session.code, session.token, boxNo)),
        offer: (amount?: number, line?: string) => act(() => api.dreamerOffer(session.code, session.token, amount, line)),
        decide: (deal: boolean) => act(() => api.dreamerDecide(session.code, session.token, deal)),
        finalPick: (choice: "keep" | "swap") => act(() => api.dreamerFinalPick(session.code, session.token, choice)),
      }
      : null,
  };
}
