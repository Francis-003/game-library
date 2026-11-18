import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, RequestError } from "@/lib/api";
import type { UserAuth } from "@/lib/types";
import type { MeSnapshot, MyRoom } from "@/lib/types";

// 好友在线与邀请的轮询：固定 10s 心跳 + 拉快照，页面隐藏时暂停，重新可见立即刷一次。
// 读失败保留旧快照等下一轮自然恢复；invalid_token 表示登录已失效，交回上层重新登录。
const PRESENCE_INTERVAL = 10_000;

type PresenceContextValue = {
  snapshot: MeSnapshot | null;
  // 我在进行中的房间（首页下半部分用）；读失败时保留上一次结果。
  rooms: MyRoom[] | null;
  authLost: boolean;
  refresh: () => Promise<void>;
};

const PresenceContext = createContext<PresenceContextValue | null>(null);

export function PresenceProvider({ user, onAuthLost, children }: {
  user: UserAuth;
  onAuthLost: () => void;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<MeSnapshot | null>(null);
  const [rooms, setRooms] = useState<MyRoom[] | null>(null);
  const [authLost, setAuthLost] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const lostRef = useRef(onAuthLost);
  lostRef.current = onAuthLost;

  const refresh = useCallback(async (): Promise<void> => {
    const auth = userRef.current;
    if (!auth) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const fresh = await api.me(auth.token, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(fresh);
      setAuthLost(false);
      // 房间列表与心跳同一节拍：一次往返就能让首页的「进行中」与在线状态一起更新。
      // 单独失败不影响好友快照，保留上一次的房间列表。
      const mine = await api.myRooms(auth.token, controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (mine) setRooms(mine);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof RequestError && error.code === "invalid_token") {
        setAuthLost(true);
        lostRef.current();
        return;
      }
      // 其他失败保留旧快照，等下一轮心跳自然恢复。
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const tick = async (immediate = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (stopped || (!immediate && document.hidden)) return;
      await refresh();
      if (stopped || document.hidden) return;
      timerRef.current = setTimeout(() => void tick(), PRESENCE_INTERVAL);
    };
    // 建房/加入房间后本地会话刚变化：不等心跳，立刻重拉房间列表与在线状态。
    const onSessionsChanged = () => { void tick(true); };
    const onVisible = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!document.hidden) void tick(true);
    };
    void tick(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("tongci:sessions-changed", onSessionsChanged);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("tongci:sessions-changed", onSessionsChanged);
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [refresh]);

  return (
    <PresenceContext.Provider value={{ snapshot, rooms, authLost, refresh }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence 必须在 PresenceProvider 内使用");
  return ctx;
}
