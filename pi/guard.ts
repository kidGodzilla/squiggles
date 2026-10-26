// Pi squiggles: the same fences as claude's --disallowedTools. No reading or writing ~/Downloads, ~/Desktop, ~/Documents.
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();
const DIRS = ["Downloads", "Desktop", "Documents"];
const fenced = (p: string) => {
  const abs = path.resolve(process.cwd(), p.replace(/^~(?=\/|$)/, HOME));
  return DIRS.some((d) => abs === path.join(HOME, d) || abs.startsWith(path.join(HOME, d) + "/"));
};
const mentions = (cmd: string) => DIRS.some((d) => new RegExp(`(~|\\$HOME|\\$\\{HOME\\}|${HOME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})/${d}\\b`).test(cmd));

export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    const input = event.input || {};
    if (["read", "edit", "write", "ls", "find", "grep"].includes(event.toolName) && typeof input.path === "string" && fenced(input.path))
      return { block: true, reason: "Downloads, Desktop and Documents are off limits" };
    if (event.toolName === "bash" && typeof input.command === "string" && mentions(input.command))
      return { block: true, reason: "Downloads, Desktop and Documents are off limits" };
  });
}
