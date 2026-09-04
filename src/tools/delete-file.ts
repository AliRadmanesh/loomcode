import { unlink } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    const path = String(args.path ?? "");
    try {
      await unlink(path);
      return `Deleted ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  describe(args) {
    return `delete ${String(args.path ?? "")}`;
  },
};
