import { readFile, writeFile } from "node:fs/promises";
import type { Tool } from "./index.ts";

export const editFileTool: Tool = {
  name: "edit_file",
  description: "Replace the first occurrence of oldString with newString in an existing file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
    },
    required: ["path", "oldString", "newString"],
  },
  async execute(args) {
    const path = String(args.path ?? "");
    const oldString = String(args.oldString ?? "");
    const newString = String(args.newString ?? "");
    try {
      const content = await readFile(path, "utf8");
      if (!content.includes(oldString)) {
        return `Error: oldString not found in ${path}`;
      }
      await writeFile(path, content.replace(oldString, newString), "utf8");
      return `Edited ${path}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
