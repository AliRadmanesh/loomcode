import type OpenAI from "openai";

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type ToolRegistry = Record<string, Tool>;

export const RISKY = new Set<string>();

export function toolSchemas(registry: ToolRegistry): OpenAI.Responses.FunctionTool[] {
  return Object.values(registry).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false,
  }));
}
