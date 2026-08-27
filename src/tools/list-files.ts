import { readdir } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const listFilesTool: Tool = {
  name: "list_files",
  description: "List the entries in a directory.",
  parameters: {
    type: "object",
    properties: { dir: { type: "string" } },
    required: ["dir"],
  },
  async execute(args) {
    const dir = String(args.dir ?? ".");
    try {
      const entries = await readdir(dir);
      return entries.join("\n");
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
