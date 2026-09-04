import type { Tool } from "../tools/index.ts";

export const mockWebSearchTool: Tool = {
  name: "web_search",
  description: "Mock web search for eval.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  async execute() {
    return "The three most recent stable Node.js versions are 24, 23, and 22.";
  },
};

export const mockRunCommandTool: Tool = {
  name: "run_command",
  description: "Mock run_command for eval.",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  },
  async execute(args) {
    const cmd = String(args.cmd ?? "");
    if (cmd.includes("false")) {
      return "Error: exited with code 1";
    }
    return "2 3 5 7 11";
  },
};
