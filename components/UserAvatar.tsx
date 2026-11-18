import { cn } from "@/lib/utils";

// 由用户名稳定派生的暖色系首字头像：同一个名字永远同色，纯前端装饰。
const PALETTE = [
  "bg-[#b4543f]", // 陶土红
  "bg-[#6e8b6a]", // 灰绿
  "bg-[#4f6f87]", // 钢蓝
  "bg-[#d9a441]", // 琥珀
  "bg-[#c97b52]", // 黏土橙
  "bg-[#7f8f5a]", // 橄榄
];

function colorFor(name: string): string {
  let sum = 0;
  for (const ch of name) sum += ch.codePointAt(0) ?? 0;
  return PALETTE[sum % PALETTE.length];
}

type Props = {
  name: string;
  // 尺寸由调用方用 className 控制（如 size-10）；online 传布尔时显示在线点。
  className?: string;
  online?: boolean;
};

export function UserAvatar({ name, className, online }: Props) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-full font-semibold text-white",
          colorFor(name),
        )}
        aria-hidden
      >
        {name.slice(0, 1) || "·"}
        <span className="sr-only">{name}</span>
      </span>
      {typeof online === "boolean" && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background",
            online ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
          aria-hidden
        />
      )}
    </span>
  );
}
