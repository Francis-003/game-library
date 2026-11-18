import { useCallback, useEffect, useRef, useState } from "react";
import { api, isSeatError, message } from "../lib/api";
import type { Session } from "../lib/session";
import type { RoomView } from "../lib/types";

const IDLE_SLOW_AFTER = 60_000;
const MAX_INTERVAL = 6_000;
// 终局后仍需慢速轮询：对方点「再来一局」是原房间就地重开，口令不变，
// 只有继续轮询才能看到 status 从 ended/matched 变回 playing。
const TERMINAL_INTERVAL = 3_000;

// 频率按“现在有什么可看”分级：还在自己输入时几乎没有需要同步的东西，
// 等对方收尾时最值得灵敏；本局进入终态后放慢到 ~3s，专门等对方发起重开。
function nextInterval(view: RoomView | null, idleFor: number): number {
  if (!view) return 1200;
  if (view.status === "matched" || view.status === "ended") return TERMINAL_INTERVAL;
  let base: number;
  if (view.mySealed && !view.opponentSealed) base = 1000;
  else if (view.status === "waiting") base = 1500;
  else if (view.mySealed) base = 1200;
  else base = 3000;
  return idleFor > IDLE_SLOW_AFTER ? Math.min(base * 2, MAX_INTERVAL) : base;
}

export function useRoom(session: Session | null) {
  const [view, setView] = useState<RoomView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const viewRef = useRef<RoomView | null>(null);
  const changedRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  viewRef.current = view;

  const refresh = useCallback(async (): Promise<RoomView | null> => {
    if (!session) return null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const fresh = await api.state(session.code, session.token, controller.signal);
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
      // 读取失败保留上一次状态，只给一条软提示，不打断正在输入的人。
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
    // immediate 用于首帧与恢复可见：即使页面开在后台标签也要读到一次状态，
    // 否则用户切进来之前界面会一直停在“正在读取”。只有重复轮询才受可见性约束。
    const tick = async (immediate = false) => {
      // 每个 tick 先清掉上一枚定时器，保证任何时刻只有一条轮询链在跑。
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (stopped || (!immediate && document.hidden)) return;
      const fresh = await refresh();
      if (stopped || document.hidden) return;
      const delay = nextInterval(fresh ?? viewRef.current, Date.now() - changedRef.current);
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

  // 写操作统一走这里：服务端在同一响应里带回最新视图，避免“我这已揭示、对方还没”的错位。
  const act = useCallback(async (run: () => Promise<RoomView>) => {
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
      // 结果未知（网络断开、5xx）时只重读状态，绝不自动重发写请求；
      // 但要把失败原因留在界面上，不然提交失败看起来就是按钮没反应。
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
        submit: (word: string) => act(() => api.submit(session.code, session.token, word)),
        nextRound: () => act(() => api.nextRound(session.code, session.token)),
        finish: () => act(() => api.finish(session.code, session.token)),
      }
      : null,
  };
}
