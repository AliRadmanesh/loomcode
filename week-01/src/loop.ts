import type OpenAI from "openai";
import { RISKY, toolSchemas, type ToolRegistry } from "./tools/index.ts";

export const MAX_STEPS = 15;

export const SYSTEM_PROMPT =
  "You are a CLI coding agent with tools to search the web and read, write, edit, list, and delete files, " +
  "and run shell commands. Prefer using your tools to verify facts and make changes over guessing. Be concise.";

// Rough estimate, not an exact tokenizer count — good enough to decide whether to compact.
const CHARS_PER_TOKEN = 3.75;
export const MAX_CONTEXT_TOKENS = 150_000;
const COMPACTION_THRESHOLD = 0.8;
// Turns kept verbatim so the model always sees the live request, never a paraphrase of it.
export const KEEP_RECENT_TURNS = 2;

function estimateTokens(input: OpenAI.Responses.ResponseInputItem[]): number {
  return JSON.stringify(input).length / CHARS_PER_TOKEN;
}

export interface CompactOptions {
  client: ResponsesClient;
  model: string;
  input: OpenAI.Responses.ResponseInputItem[];
}

export async function compactIfNeeded(opts: CompactOptions): Promise<void> {
  const { client, model, input } = opts;
  if (estimateTokens(input) < MAX_CONTEXT_TOKENS * COMPACTION_THRESHOLD) return;

  const userIndices = input.reduce<number[]>((acc, item, i) => {
    if ("role" in item && item.role === "user") acc.push(i);
    return acc;
  }, []);
  if (userIndices.length <= KEEP_RECENT_TURNS) return;

  const cutIndex = userIndices[userIndices.length - KEEP_RECENT_TURNS]!;
  const oldItems = input.slice(0, cutIndex);
  const summaryRequest = [
    ...oldItems,
    {
      role: "developer" as const,
      content: "Summarize this conversation so far in a few sentences, preserving important facts, decisions, and open threads.",
    },
  ];
  const response = await client.responses.create({ model, input: summaryRequest, tools: [] });

  input.splice(0, cutIndex, {
    role: "developer",
    content: `Summary of earlier conversation:\n${response.output_text}`,
  });
}

export interface ResponsesClient {
  responses: {
    create(params: {
      model: string;
      input: OpenAI.Responses.ResponseInputItem[];
      tools: OpenAI.Responses.FunctionTool[];
      instructions?: string;
    }): Promise<{ output: OpenAI.Responses.ResponseOutputItem[]; output_text: string }>;
  };
}

export interface RunTurnOptions {
  client: ResponsesClient;
  model: string;
  input: OpenAI.Responses.ResponseInputItem[];
  registry: ToolRegistry;
  confirm: (toolName: string, description: string) => Promise<boolean>;
}

export async function runTurn(opts: RunTurnOptions): Promise<string> {
  const { client, model, input, registry, confirm } = opts;
  const tools = toolSchemas(registry);

  await compactIfNeeded({ client, model, input });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.responses.create({ model, input, tools, instructions: SYSTEM_PROMPT });

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );

    if (calls.length === 0) {
      return response.output_text;
    }

    for (const call of calls) {
      input.push(call);
      console.log(`[tool] ${call.name}(${call.arguments})`);
      const tool = registry[call.name];
      let result: string;

      if (!tool) {
        result = `Error: unknown tool "${call.name}"`;
      } else {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch (err) {
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: `Error: invalid arguments JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }
        if (RISKY.has(call.name)) {
          const allowed = await confirm(call.name, `${call.name}(${call.arguments})`);
          result = allowed ? await tool.execute(args) : "User denied this action.";
        } else {
          result = await tool.execute(args);
        }
      }

      input.push({ type: "function_call_output", call_id: call.call_id, output: result });
    }
  }

  return `Gave up after ${MAX_STEPS} steps without a final answer.`;
}
