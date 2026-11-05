// Pi squiggles: the same fences as claude's --disallowedTools, plus ~/.ssh and git push (fence.mjs).
import { pathReason, commandReason, editReason, peerReason, privateCheck, REASONS } from "../fence.mjs";

export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    let reason = "";
    try { // A throw refuses: Pi has no hook exit code to fail closed on.
      const input = event.input || {};
      reason = ["read", "edit", "write", "ls", "find", "grep"].includes(event.toolName) && typeof input.path === "string" ? pathReason(input.path) || editReason(event.toolName, input)
        : event.toolName === "bash" && typeof input.command === "string" ? commandReason(input.command) : "";
      reason ||= privateCheck(event.toolName, input, process.cwd()) || peerReason(event.toolName, input, { cwd: process.cwd() });
    } catch { reason = REASONS.crash; }
    if (reason) return { block: true, reason };
  });
}
