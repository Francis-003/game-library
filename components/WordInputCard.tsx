import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeWord } from "@/lib/normalize";
import type { RoomView } from "@/lib/types";

type Props = {
  busy: boolean;
  disabled: boolean;
  onSubmit: (word: string) => Promise<RoomView | null>;
};

export function WordInputCard({ busy, disabled, onSubmit }: Props) {
  const [word, setWord] = useState("");
  const [pending, setPending] = useState(false);
  const result = normalizeWord(word);
  const onlyPunctuation = word.trim().length > 0 && !result.ok;

  async function send() {
    if (!result.ok || busy || pending) return;
    setPending(true);
    const view = await onSubmit(result.raw);
    setPending(false);
    // 只有确认服务端已封存才清空输入，避免结果未知时把想好的词弄丢。
    if (view?.mySealed) setWord("");
  }

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">你的词</span>
        <span className="text-xs text-muted-foreground">提交后不能修改</span>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Input
          autoFocus
          value={word}
          onChange={(event) => setWord(event.target.value)}
          placeholder="想一个词"
          enterKeyHint="send"
          maxLength={120}
          disabled={disabled || busy || pending}
          className="h-12 min-w-0 flex-1 rounded-xl text-base"
          aria-label="想一个词"
        />
        <Button
          type="submit"
          size="lg"
          className="h-12 shrink-0 rounded-xl px-5"
          disabled={!result.ok || disabled || busy || pending}
        >
          {pending || busy ? "提交中" : "提交"}
        </Button>
      </form>
      <p className="mt-2 min-h-5 text-xs text-muted-foreground">
        {onlyPunctuation
          ? "这些字符都是标点，还无法作为词语提交。"
          : "字数不限；TA 看不见你写了什么，要等两个人都提交完才一起揭开。"}
      </p>
    </div>
  );
}
