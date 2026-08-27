import { readFile as fsReadFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a file's contents.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async execute(args) {
    const path = String(args.path ?? "");
    try {
      return await fsReadFile(path, "utf8");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
