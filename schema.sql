-- 同词遇见 · 数据模型
-- 只使用 Qoder Sites 迁移支持的受限子集：CREATE TABLE / 普通 CREATE INDEX /
-- UNIQUE 建表约束 / REFERENCES。不使用 CHECK、触发器、生成列、数组、varchar(n)、DML。
--
-- 除时间戳外全部列 NOT NULL 并给出哨兵默认值，因为 Function 侧的等值过滤只能可靠地
-- 比较具体值（token 未占用时用空串而非 NULL 表示），不能依赖 IS NULL 语义。

CREATE TABLE app.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'waiting',
  current_round integer NOT NULL DEFAULT 1,
  round_id uuid NOT NULL,
  scene_text text NOT NULL DEFAULT '',
  scene_source text NOT NULL DEFAULT '',
  token_a text NOT NULL,
  token_b text NOT NULL DEFAULT '',
  join_key_b text NOT NULL DEFAULT '',
  nick_a text NOT NULL DEFAULT '',
  nick_b text NOT NULL DEFAULT '',
  win_round integer NOT NULL DEFAULT 0,
  ended_by text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  touched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.room_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app.rooms (id),
  round_no integer NOT NULL,
  word_a text NOT NULL DEFAULT '',
  word_b text NOT NULL DEFAULT '',
  norm_a text NOT NULL DEFAULT '',
  norm_b text NOT NULL DEFAULT '',
  sealed_a boolean NOT NULL DEFAULT false,
  sealed_b boolean NOT NULL DEFAULT false,
  submitted_at_a timestamptz,
  submitted_at_b timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, round_no)
);

CREATE TABLE app.custom_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  added_by text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX custom_scenes_enabled_idx ON app.custom_scenes (enabled, created_at);

-- 全局用户身份：无密码，名字即账号，先到先得（重名拒绝）。
-- token 是唯一身份凭据，只随登录响应下发一次，绝不出现在其他任何响应里。
CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  token text NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 房间邀请：from_name 指向的房间席位发起，to_name 的用户轮询 me 时领取。
-- game 区分口令属于哪个游戏（两个游戏的口令空间互不相通，撞码时靠它定位房间）。
-- 不设状态列：过期靠 created_at 时间窗过滤，接受/忽略都直接删行。
CREATE TABLE app.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL,
  game text NOT NULL DEFAULT 'tongci',
  from_name text NOT NULL,
  to_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_to_idx ON app.invites (to_name, created_at);

-- 再来一局确认：跨游戏共用。一方发起（pending），另一方接受（双方进入新局）
-- 或拒绝（发起方收到「对方不来了」）。口令/席位/token 不变，状态只记录意图。
-- 不设外键：两个游戏的对局在不同表，靠 game + room_code 定位；随对局重开/作废由服务端清理。
CREATE TABLE app.rematch_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game text NOT NULL DEFAULT 'tongci',
  room_code text NOT NULL,
  from_seat text NOT NULL DEFAULT '',
  to_seat text NOT NULL DEFAULT '',
  from_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  touched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game, room_code, from_seat)
);

CREATE INDEX rematch_lookup_idx ON app.rematch_requests (game, room_code, status);

-- 白日梦想家 · 开箱排雷。金额梯、开箱表、报价系数的真源在 functions/shared/dreamer.mjs。
-- 保密模型：双方都不知道未开箱子的金额，数据库之外的任何响应都不携带未开箱的 box→金额映射。
CREATE TABLE app.dreamer_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'waiting',
  tier text NOT NULL DEFAULT 'standard',
  banker_seat text NOT NULL DEFAULT 'b',
  token_a text NOT NULL,
  token_b text NOT NULL DEFAULT '',
  join_key_b text NOT NULL DEFAULT '',
  nick_a text NOT NULL DEFAULT '',
  nick_b text NOT NULL DEFAULT '',
  round_no integer NOT NULL DEFAULT 0,
  opened_in_round integer NOT NULL DEFAULT 0,
  lucky_box integer NOT NULL DEFAULT 0,
  offer_base numeric NOT NULL DEFAULT 0,
  offer_amount numeric NOT NULL DEFAULT 0,
  offer_line text NOT NULL DEFAULT '',
  offer_sent boolean NOT NULL DEFAULT false,
  final_pick text NOT NULL DEFAULT '',
  deal_taken boolean NOT NULL DEFAULT false,
  won_amount numeric NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  touched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.dreamer_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES app.dreamer_games (id),
  box_no integer NOT NULL,
  amount numeric NOT NULL,
  opened boolean NOT NULL DEFAULT false,
  opened_round integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, box_no)
);

-- 报价历史：decision 为空串表示等待玩家决定；deal / no_deal 为已决定。
CREATE TABLE app.dreamer_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES app.dreamer_games (id),
  round_no integer NOT NULL,
  base_amount numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  line text NOT NULL DEFAULT '',
  decision text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, round_no)
);
