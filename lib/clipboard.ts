export function inviteUrl(code: string, game = "tongci"): string {
  // 只带口令：席位密钥永远不进 URL，否则分享链接等于分享席位。
  return `${window.location.origin}${window.location.pathname}#/g/${game}/r/${code}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      field.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
