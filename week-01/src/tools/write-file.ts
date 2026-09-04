import { writeFile as fsWriteFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create a file or overwrite it with new content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
  async execute(args) {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    try {
      await fsWriteFile(path, content, "utf8");
      return `Wrote ${content.length} bytes to ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  describe(args) {
    return `write ${String(args.path ?? "")} (${String(args.content ?? "").length} bytes)`;
  },
};
