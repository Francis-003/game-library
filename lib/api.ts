import type { CustomScene, DreamerRole, DreamerView, FriendEntry, InviteEntry, JoinResult, MeSnapshot, RoomView, SceneLibrary, UserAuth } from "./types";

export class RequestError extends Error {
  constructor(
    public code: string,
    public status = 0,
    // uncertain 表示服务端可能已经完成写入，只是响应没送达：一律先重读状态，不盲目重发写请求。
    public uncertain = false,
  ) {
    super(code);
  }
}

const ENDPOINT = "/functions/v1/app";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}${path}`, {
      ...init,
      credentials: "same-origin",
      signal: init?.signal ?? AbortSignal.timeout(20_000),
    });
  } catch {
    throw new RequestError("network_error", 0, init?.method && init.method !== "GET" ? true : false);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RequestError("invalid_response", response.status, true);
  }
  if (!response.ok) {
    const code = typeof (body as { error?: unknown })?.error === "string" ? (body as { error: string }).error : "request_failed";
    throw new RequestError(code, response.status, response.status >= 500 || response.status === 408);
  }
  return body as T;
}

function post<T>(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

function withQuery(path: string, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return `${path}?${search.toString()}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// 在服务端返回的形状不符合预期时立刻报错，而不是让 undefined 流进渲染层。
export function roomView(value: unknown): RoomView {
  if (!isRecord(value)) throw new RequestError("invalid_response", 0, true);
  const statuses = ["waiting", "playing", "revealed", "matched", "ended"];
  if (
    typeof value.code !== "string" ||
    !Number.isInteger(value.rev) ||
    (value.seat !== "a" && value.seat !== "b") ||
    typeof value.status !== "string" ||
    !statuses.includes(value.status) ||
    !Number.isInteger(value.round) ||
    typeof value.mySealed !== "boolean" ||
    typeof value.opponentSealed !== "boolean" ||
    !Array.isArray(value.history)
  ) {
    throw new RequestError("invalid_response", 0, true);
  }
  if (value.opponentWord !== undefined && typeof value.opponentWord !== "string") {
    throw new RequestError("invalid_response", 0, true);
  }
  return value as unknown as RoomView;
}

function joinResult(value: unknown): JoinResult {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.token !== "string"
    || (value.seat !== "a" && value.seat !== "b")) {
    throw new RequestError("invalid_response", 0, true);
  }
  return { code: value.code, seat: value.seat, token: value.token, view: roomView(value.view) };
}

type DreamerJoined = { code: string; seat: "a" | "b"; token: string; view: DreamerView };
function dreamerJoined(value: unknown): DreamerJoined {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.token !== "string"
    || (value.seat !== "a" && value.seat !== "b")) {
    throw new RequestError("invalid_response", 0, true);
  }
  return { code: value.code, seat: value.seat, token: value.token, view: dreamerView(value.view) };
}

function dreamerView(value: unknown): DreamerView {
  if (!isRecord(value) || typeof value.code !== "string" || !Number.isInteger(value.rev)
    || (value.seat !== "a" && value.seat !== "b")
    || (value.role !== "player" && value.role !== "banker")
    || typeof value.status !== "string" || typeof value.phase !== "string"
    || typeof value.tier !== "string" || !Number.isInteger(value.boxCount)
    || !Array.isArray(value.boxes) || !Array.isArray(value.remainingAmounts) || !Array.isArray(value.offers)) {
    throw new RequestError("invalid_response", 0, true);
  }
  return value as unknown as DreamerView;
}

function sceneLibrary(value: unknown): SceneLibrary {
  if (!isRecord(value) || !Array.isArray(value.builtin) || !Array.isArray(value.custom)) {
    throw new RequestError("invalid_response");
  }
  const custom: CustomScene[] = value.custom.filter((row): row is CustomScene =>
    isRecord(row) && typeof row.id === "string" && typeof row.name === "string" && typeof row.enabled === "boolean");
  return {
    builtin: value.builtin.filter((row) => isRecord(row) && typeof row.name === "string") as SceneLibrary["builtin"],
    custom,
  };
}

// 登录响应校验：只有 name + token，token 绝不该出现在其他任何响应里。
function userAuth(value: unknown): UserAuth {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name
    || typeof value.token !== "string" || !value.token) {
    throw new RequestError("invalid_response", 0, true);
  }
  return { name: value.name, token: value.token };
}

// me 快照校验：好友与邀请逐条校验，坏行直接丢弃而不是整体失败。
function meSnapshot(value: unknown): MeSnapshot {
  if (!isRecord(value) || typeof value.name !== "string") throw new RequestError("invalid_response", 0, true);
  const friends = Array.isArray(value.friends) ? value.friends : [];
  const invites = Array.isArray(value.invites) ? value.invites : [];
  return {
    name: value.name,
    friends: friends
      .filter((row): row is FriendEntry => isRecord(row) && typeof row.name === "string" && typeof row.online === "boolean")
      .map(row => ({ name: row.name, online: row.online })),
    invites: invites
      .filter((row): row is InviteEntry =>
        isRecord(row) && typeof row.id === "string" && typeof row.roomCode === "string" && typeof row.fromName === "string")
      .map(row => ({ id: row.id, roomCode: row.roomCode, fromName: row.fromName })),
  };
}

export const api = {
  // 白日梦想家
  dreamerCreate: (nick: string, role: DreamerRole, tier: string) =>
    post<unknown>("/api/dreamer/games", { ...(nick ? { nick } : {}), role, tier }).then(dreamerJoined),
  dreamerJoin: (code: string, joinKey: string, nick: string) =>
    post<unknown>("/api/dreamer/games/join", { code, joinKey, ...(nick ? { nick } : {}) }).then(dreamerJoined),
  dreamerState: (code: string, token: string, signal?: AbortSignal) =>
    request<{ view: DreamerView }>(withQuery("/api/dreamer/games/state", { code, token }), { signal })
      .then((body) => dreamerView(body.view)),
  dreamerPickLucky: (code: string, token: string, boxNo: number) =>
    post<{ view: DreamerView }>("/api/dreamer/pick-lucky", { code, token, boxNo }).then((body) => dreamerView(body.view)),
  dreamerOpen: (code: string, token: string, boxNo: number) =>
    post<{ view: DreamerView }>("/api/dreamer/open", { code, token, boxNo }).then((body) => dreamerView(body.view)),
  dreamerOffer: (code: string, token: string, amount?: number, line?: string) =>
    post<{ view: DreamerView }>("/api/dreamer/offer", {
      code, token,
      ...(amount !== undefined ? { amount } : {}),
      ...(line ? { line } : {}),
    }).then((body) => dreamerView(body.view)),
  dreamerDecide: (code: string, token: string, deal: boolean) =>
    post<{ view: DreamerView }>("/api/dreamer/decide", { code, token, deal }).then((body) => dreamerView(body.view)),
  dreamerFinalPick: (code: string, token: string, choice: "keep" | "swap") =>
    post<{ view: DreamerView }>("/api/dreamer/final-pick", { code, token, choice }).then((body) => dreamerView(body.view)),
  dreamerRematch: (code: string, token: string, nick: string) =>
    post<unknown>("/api/dreamer/rematch", { code, token, ...(nick ? { nick } : {}) }).then(dreamerJoined),
  createRoom: (nick: string) => post<JoinResult>("/api/rooms", { ...(nick ? { nick } : {}) }).then(joinResult),
  joinRoom: (code: string, joinKey: string, nick: string) =>
    post<JoinResult>("/api/rooms/join", { code, joinKey, ...(nick ? { nick } : {}) }).then(joinResult),
  // 加入响应丢失后的自愈通道：同一个 joinKey 会取回原来的席位密钥。
  rejoin: (code: string, joinKey: string) =>
    post<JoinResult>("/api/rooms/join", { code, joinKey }).then(joinResult),
  state: (code: string, token: string, signal?: AbortSignal) =>
    request<{ view: RoomView }>(withQuery("/api/rooms/state", { code, token }), { signal }).then(
      (body) => roomView(body.view),
    ),
  submit: (code: string, token: string, word: string) =>
    post<{ view: RoomView }>("/api/rooms/submit", { code, token, word }).then((body) => roomView(body.view)),
  nextRound: (code: string, token: string) =>
    post<{ view: RoomView }>("/api/rooms/next-round", { code, token }).then((body) => roomView(body.view)),
  finish: (code: string, token: string) =>
    post<{ view: RoomView }>("/api/rooms/finish", { code, token }).then((body) => roomView(body.view)),
  rematch: (code: string, token: string, nick: string) =>
    post<JoinResult>("/api/rooms/rematch", { code, token, ...(nick ? { nick } : {}) }).then(joinResult),
  scenes: (code: string, token: string, signal?: AbortSignal) =>
    request<unknown>(withQuery("/api/scenes", { code, token }), { signal }).then(sceneLibrary),
  addScene: (code: string, token: string, name: string) =>
    post<{ scene: CustomScene }>("/api/scenes/add", { code, token, name }).then((body) => body.scene),
  toggleScene: (code: string, token: string, id: string, enabled: boolean) =>
    post<{ scene: CustomScene }>("/api/scenes/toggle", { code, token, id, enabled }).then((body) => body.scene),
  // 无密码登录：用户名即账号，先到先得。
  login: (name: string) => post<UserAuth>("/api/users/login", { name }).then(userAuth),
  // 心跳 + 好友在线 + 收到的邀请，一个快照全带回。
  me: (token: string, signal?: AbortSignal) =>
    request<unknown>(withQuery("/api/me", { token }), { signal }).then(meSnapshot),
  invite: (code: string, token: string, to: string) =>
    post<{ invite: InviteEntry }>(
      "/api/invites",
      { code, token, to },
    ).then((body) => body.invite),
  dismissInvite: (token: string, id: string) =>
    post<unknown>("/api/invites/dismiss", { token, id }).then(() => undefined),
};

const MESSAGES: Record<string, string> = {
  invalid_input: "内容不太对，检查一下再试。",
  invalid_response: "服务返回了无法识别的结果，请重新读取。",
  network_error: "连接中断，正在按最新状态重新确认。",
  not_found: "没有找到这个房间，检查下 6 位口令。",
  not_a_seat: "这个房间的席位不属于当前设备，已退出。",
  seat_taken: "这个房间的另一个位置已经有人了。",
  word_locked: "词语提交后就不能改了，等对方说完吧。",
  round_not_open: "这一轮现在不能提交，已同步到最新状态。",
  version_conflict: "状态刚被更新，已重新读取。",
  scene_exists: "这个场景已经在库里了。",
  no_scene_available: "场景库空了，先添加一个场景。",
  payload_too_large: "内容太长了。",
  db_unavailable: "存档服务暂时不可用，稍等一下再试。",
  database_unavailable: "存档服务暂时不可用，稍等一下再试。",
  database_not_configured: "数据服务尚未配置完成。",
  database_credential_rejected: "数据服务暂不可用，请联系站点管理员。",
  name_taken: "这个名字已经被使用了，换一个试试。",
  invalid_token: "登录状态已失效，请重新输入用户名。",
  room_not_waiting: "这个房间已经不缺人了，不用再邀请。",
  role_mismatch: "现在不是你的角色回合，等一等。",
  phase_wrong: "现在还不能做这个操作，已同步到最新进度。",
  box_unavailable: "这个箱子现在不能开，换一个吧。",
  offer_out_of_range: "报价超出参考价的 ±20% 范围，调整后再发。",
  offer_already_sent: "这一轮已经报过价了。",
  decision_made: "已经做过决定了，不能改口。",
  request_failed: "暂时没能完成，稍后再试。",
};

export function message(error: unknown): string {
  const code = error instanceof RequestError ? error.code : "";
  return MESSAGES[code] ?? "暂时无法完成，请稍后重试。";
}

export function isUncertain(error: unknown): boolean {
  return error instanceof RequestError && error.uncertain;
}

export function isSeatError(error: unknown): boolean {
  return error instanceof RequestError && (error.code === "not_a_seat" || error.code === "not_found");
}
