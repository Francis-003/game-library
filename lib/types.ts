export type Seat = "a" | "b";
export type RoomStatus = "waiting" | "playing" | "revealed" | "matched" | "ended";

export type Scene = { text: string; source: string };

export type HistoryEntry = {
  round: number;
  wordA: string;
  wordB: string;
  matched: boolean;
};

// 与 functions/routes.mjs 的 buildSeatView 一一对应。对手的词只在揭示后才会出现，
// 因此这里是可选字段——不存在就是服务端没给，前端无法自行还原。
export type RoomView = {
  code: string;
  rev: number;
  seat: Seat;
  status: RoomStatus;
  round: number;
  scene: Scene | null;
  myNick: string | null;
  opponentNick: string | null;
  mySealed: boolean;
  opponentSealed: boolean;
  myWord: string | null;
  history: HistoryEntry[];
  opponentWord?: string;
  matched?: boolean;
  winRound?: number;
  endedBy?: string | null;
};

export type BuiltinScene = { name: string; category: string };
export type CustomScene = {
  id: string;
  name: string;
  addedBy: string | null;
  enabled: boolean;
  createdAt?: string | null;
};
export type SceneLibrary = { builtin: BuiltinScene[]; custom: CustomScene[] };

export type JoinResult = { code: string; seat: Seat; token: string; view: RoomView };

// 无密码全局身份：token 只在登录响应里下发一次，存 localStorage。
export type UserAuth = { name: string; token: string };
export type FriendEntry = { name: string; online: boolean };
export type InviteEntry = { id: string; roomCode: string; fromName: string };
export type MeSnapshot = { name: string; friends: FriendEntry[]; invites: InviteEntry[] };

// ---- 白日梦想家 ----
export type DreamerRole = "player" | "banker";
export type DreamerPhase =
  | "waiting" | "pick_lucky" | "opening" | "offer" | "decide"
  | "final_offer" | "final_decide" | "final_pick" | "ended";

export type DreamerBox = {
  no: number;
  opened: boolean;
  // 保密核心：未开且未揭开的箱子金额为 null。
  amount: number | null;
  openedRound: number | null;
};

export type DreamerOffer = {
  roundNo: number;
  amount: number;
  base: number;
  line: string | null;
  decision: "deal" | "no_deal" | null;
};

export type DreamerResult = {
  dealt: boolean;
  wonAmount: number;
  luckyBox: number | null;
  luckyAmount: number | null;
  finalBoxNo: number | null;
};

// 与 functions/routes.mjs 的 buildDreamerView 一一对应。
export type DreamerView = {
  code: string;
  rev: number;
  seat: Seat;
  role: DreamerRole;
  status: "waiting" | "playing" | "ended";
  phase: DreamerPhase;
  tier: string;
  tierName: string;
  boxCount: number;
  myNick: string | null;
  opponentNick: string | null;
  roundNo: number;
  openingsLeft: number;
  luckyBox: number | null;
  boxes: DreamerBox[];
  remainingAmounts: number[];
  offers: DreamerOffer[];
  currentOffer: { roundNo: number; amount: number; line: string | null } | null;
  offerBase: number | null;
  finalPick: "keep" | "swap" | null;
  result?: DreamerResult;
};
