// 白日梦想家 · 前端档位元数据镜像。金额梯与报价系数的真源在 functions/shared/dreamer.mjs，
// 这里只放展示用的档位卡片元数据，避免把后端规则数据复制到前端。
export type DreamerTierMeta = {
  key: "small" | "standard" | "show";
  name: string;
  boxCount: number;
  rangeLabel: string;
  note: string;
};

export const DREAMER_TIERS: DreamerTierMeta[] = [
  {
    key: "small",
    name: "小赌怡情",
    boxCount: 10,
    rangeLabel: "0.1 – 1314 元",
    note: "节奏快，适合几分钟一局",
  },
  {
    key: "standard",
    name: "标准局",
    boxCount: 16,
    rangeLabel: "0.1 – 9999 元",
    note: "经典综艺节奏",
  },
  {
    key: "show",
    name: "综艺局",
    boxCount: 22,
    rangeLabel: "0.1 – 52000 元",
    note: "22 个箱子，轮次最多",
  },
];
