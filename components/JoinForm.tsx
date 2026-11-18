import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, message } from "@/lib/api";
import { loadUser, newJoinKey, saveSession, type Session } from "@/lib/session";
import { toast } from "sonner";

const ALPHABET = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

type Props = {
  // 传 code 表示口令已由链接确定；不传则自己输入口令。
  // 昵称一律取全局用户名，这里不再单独问。
  code?: string;
  onJoined: (session: Session) => void;
};

export function JoinForm({ code, onJoined }: Props) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const target = (code ?? input).toUpperCase();

  async function join() {
    const nick = loadUser()?.name ?? "";
    if (!ALPHABET.test(target)) {
      toast.error("口令是 6 位字母数字（没有 0、1、I、O）");
      return;
    }
    setPending(true);
    const joinKey = newJoinKey();
    try {
      const result = await api.joinRoom(target, joinKey, nick);
      const session: Session = { code: result.code, seat: result.seat, token: result.token, joinKey, nick };
      saveSession(session);
      onJoined(session);
    } catch (error) {
      toast.error(message(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
      {code ? (
        <p className="text-sm">
          <span className="text-muted-foreground">房间口令 </span>
          <span className="font-mono text-base tracking-[0.2em]">{target}</span>
        </p>
      ) : (
        <Input
          value={input}
          onChange={(event) => setInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="输入 6 位口令"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className="h-12 text-center font-mono text-lg tracking-[0.3em]"
          aria-label="房间口令"
        />
      )}
      <Button size="lg" className="h-12 w-full rounded-lg" disabled={pending} onClick={() => void join()}>
        {pending ? "进入中" : "进入这一局"}
      </Button>
    </div>
  );
}
