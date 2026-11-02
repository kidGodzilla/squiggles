// Pi squiggles: the same fences as claude's --disallowedTools, plus ~/.ssh and git push (fence.mjs).
import { pathReason, commandReason, privateCheck } from "../fence.mjs";

export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    const input = event.input || {};
    let reason = ["read", "edit", "write", "ls", "find", "grep"].includes(event.toolName) && typeof input.path === "string" ? pathReason(input.path)
      : event.toolName === "bash" && typeof input.command === "string" ? commandReason(input.command) : "";
    reason ||= privateCheck(event.toolName, input, process.cwd());
    if (reason) return { block: true, reason };
  });
}
