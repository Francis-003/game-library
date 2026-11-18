// 白日梦想家 · 游戏配置与规则真源。
// 金额梯、开箱表、报价系数只在这里，避免两份可漂移的规则数据。
// 保密模型：双方都不知道未开箱子的金额；「还剩哪些金额」是公开信息（金额板）。

export const OFFER_FACTORS = [
  0.35, 0.5, 0.65,
  0.75, 0.85, 0.95,
];

// 台词长度上限（字符数）。
export const MAX_LINE = 60;

// 开箱表：每轮开几个公共箱；总和必然 = 箱数 - 2
// （幸运箱 + 终局留 1 个公共箱供交换）。
export const TIERS = {
  small: {
    name: '小赌怡情',
    boxCount: 10,
    ladder: [
      0.1, 1, 5.2, 10, 52,
      66, 88, 520, 999, 1314,
    ],
    schedule: [3, 2, 2, 1],
  },
  standard: {
    name: '标准局',
    boxCount: 16,
    ladder: [
      0.1, 1, 5.2, 10, 52,
      66, 88, 131.4, 520, 666,
      999, 1314, 2333, 5200,
      8888, 9999,
    ],
    schedule: [4, 4, 3, 2, 1],
  },
  show: {
    name: '综艺局',
    boxCount: 22,
    ladder: [
      0.1, 1, 5.2, 10, 52,
      66, 88, 131.4, 520, 666,
      999, 1314, 2333, 5200, 6666,
      8888, 9999, 13140, 16888, 23333,
      31314, 52000,
    ],
    schedule: [5, 5, 4, 3, 2, 1],
  },
};

export function isTier(value) {
  return typeof value === 'string' && Object.hasOwn(TIERS, value);
}

// 未开箱子的金额多重集，降序。含幸运箱（终局才揭开），是公开信息，不是秘密。
export function remainingAmounts(boxes) {
  return boxes
    .filter(box => !box.opened)
    .map(box => box.amount)
    .sort((x, y) => y - x);
}

// 报价参考价 = 常识... 报价参考价 = 剩余含幸运箱的平均值 × 系数
// （按已报价次数取档，超出取最后一档），保留两位小数。
export function baseOffer(boxes, offersCount) {
  const remaining = remainingAmounts(boxes);
  if (!remaining.length) return 0;
  const total = remaining.reduce((sum, value) => sum + value, 0);
  const factor = OFFER_FACTORS[
    Math.min(offersCount, OFFER_FACTORS.length - 1)
  ];
  const raw = (total / remaining.length) * factor;
  return Math.max(0.01, Math.round(raw * 100) / 100);
}

// 未翻开箱子的面额均值（含幸运箱），即金额板的平均值。只作为出价提示，不构成限制。
export function rawAverage(boxes) {
  const remaining = remainingAmounts(boxes);
  if (!remaining.length) return 0;
  const total = remaining.reduce((sum, value) => sum + value, 0);
  return Math.round((total / remaining.length) * 100) / 100;
}

// crypto.getRandomValues 在 Deno 与 Node 22+ 都是全局可用。
export function shuffleLadder(ladder) {
  const values = [...ladder];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    const pick = buffer[0] % (index + 1);
    [values[index], values[pick]] = [values[pick], values[index]];
  }
  return values;
}
