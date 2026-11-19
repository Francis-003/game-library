export type Seat = "a" | "b";
export type RoomStatus = "waiting" | "playing" | "revealed" | "matched" | "ended";

// 再来一局的共享意图，由服务端按下发席位推导，前端只负责展示与操作。
// - waiting：我发起，等待对方确认；
// - incoming：对方发起，等待我确认/拒绝；
// - declined：我发起但对方拒绝或退出。
export type RematchInfo = {
  status: "waiting" | "incoming" | "declined";
  fromSeat: Seat;
  fromName: string;
};

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
  rematch: RematchInfo | null;
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
// 再来一局是原房间就地重开：口令与席位凭据都不变，响应不再下发 token。
export type RematchResult = { code: string; seat: Seat; view: RoomView };

// 无密码全局身份：token 只在登录响应里下发一次，存 localStorage。
export type UserAuth = { name: string; token: string };
export type FriendEntry = { name: string; online: boolean };
export type InviteEntry = { id: string; roomCode: string; game: string; fromName: string };
export type MeSnapshot = { name: string; friends: FriendEntry[]; invites: InviteEntry[] };

// 首页「我的房间」列表：只含公开信息，席位凭据仍在本地 localStorage。
export type MyRoom = {
  code: string;
  game: string;
  status: "waiting" | "playing";
  seat: Seat;
  myNick: string | null;
  opponentNick: string | null;
  roundNo: number;
  tierName: string | null;
  createdAt: string | null;
  // 未开始的房间的自动销毁时间；已开局为 null（不会自动销毁）。
  expiresAt: string | null;
};

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
  // 净收益模型：P = 银行家买断幸运箱的钱（成交价 / 最后一轮报价），V = 幸运箱真实面额。
  // 玩家净收益 = P − V，银行家净收益 = V − P，两者恒相反。
  p: number;
  luckyAmount: number;
  playerGain: number;
  bankerGain: number;
  luckyBox: number | null;
  finalBoxNo: number | null;
  finalAmount: number | null;
  dealAmount: number | null;
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
  averageLeft: number | null;
  finalPick: "keep" | "swap" | null;
  result?: DreamerResult;
  rematch: RematchInfo | null;
};
