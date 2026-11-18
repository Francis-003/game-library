import * as dreamer from '../functions/shared/dreamer.mjs';

let failed = 0;
const ok = (name, cond, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!cond) failed += 1;
};

for (const key of Object.keys(dreamer.TIERS)) {
  const tier = dreamer.TIERS[key];
  const ladderOk = tier.ladder.length === tier.boxCount
    && new Set(tier.ladder).size === tier.boxCount
    && tier.schedule.reduce((a, b) => a + b, 0) === tier.boxCount - 2;
  ok(`tier ${key} 自洽`, ladderOk,
    `boxCount=${tier.boxCount} ladder=${tier.ladder.length} scheduleSum=${tier.schedule.reduce((a, b) => a + b, 0)}`);
}

const boxes = dreamer.TIERS.standard.ladder.map((amount, index) => ({ amount, opened: index < 3 }));
const base = dreamer.baseOffer(boxes, 0);
ok('baseOffer > 0', base > 0, String(base));
ok('baseOffer = 剩余平均×0.35', Math.abs(base - dreamer.TIERS.standard.ladder.slice(3).reduce((a, b) => a + b, 0) / 13 * 0.35) < 0.01, String(base));
ok('rawAverage = 未翻面额均值', Math.abs(dreamer.rawAverage(boxes) - dreamer.TIERS.standard.ladder.slice(3).reduce((a, b) => a + b, 0) / 13) < 0.01, String(dreamer.rawAverage(boxes)));
ok('isTier', dreamer.isTier('small') && dreamer.isTier('standard') && dreamer.isTier('show') && !dreamer.isTier('nope'));
ok('shuffle 保持多重集', dreamer.shuffleLadder(dreamer.TIERS.show.ladder).slice().sort((a, b) => a - b)
  .join() === dreamer.TIERS.show.ladder.slice().sort((a, b) => a - b).join());
ok('shuffle 确实打乱（22 个几乎不可能原地不动）', dreamer.shuffleLadder(dreamer.TIERS.show.ladder).some((v, i) => v !== dreamer.TIERS.show.ladder[i]));

process.exit(failed ? 1 : 0);
