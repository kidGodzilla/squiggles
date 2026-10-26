// Pi squiggles: the same fences as claude's --disallowedTools, plus ~/.ssh and git push (fence.mjs).
import { pathReason, commandReason } from "../fence.mjs";

export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    const input = event.input || {};
    const reason = ["read", "edit", "write", "ls", "find", "grep"].includes(event.toolName) && typeof input.path === "string" ? pathReason(input.path)
      : event.toolName === "bash" && typeof input.command === "string" ? commandReason(input.command) : "";
    if (reason) return { block: true, reason };
  });
}
