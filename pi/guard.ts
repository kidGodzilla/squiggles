// Pi squiggles: the same fences as claude's --disallowedTools. No reading or writing ~/Downloads, ~/Desktop, ~/Documents (fence.mjs).
import { fencedPath, fencedCommand, REASON } from "../fence.mjs";

export default function (pi: any) {
  pi.on("tool_call", async (event: any) => {
    const input = event.input || {};
    if (["read", "edit", "write", "ls", "find", "grep"].includes(event.toolName) && typeof input.path === "string" && fencedPath(input.path))
      return { block: true, reason: REASON };
    if (event.toolName === "bash" && typeof input.command === "string" && fencedCommand(input.command))
      return { block: true, reason: REASON };
  });
}
