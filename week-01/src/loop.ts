import type OpenAI from "openai";
import { RISKY, toolSchemas, type ToolRegistry } from "./tools/index.ts";

export const MAX_STEPS = 15;

export interface ResponsesClient {
  responses: {
    create(params: {
      model: string;
      input: OpenAI.Responses.ResponseInputItem[];
      tools: OpenAI.Responses.FunctionTool[];
    }): Promise<{ output: OpenAI.Responses.ResponseOutputItem[]; output_text: string }>;
  };
}

export interface RunTurnOptions {
  client: ResponsesClient;
  model: string;
  input: OpenAI.Responses.ResponseInputItem[];
  registry: ToolRegistry;
  confirm: (description: string) => Promise<boolean>;
}

export async function runTurn(opts: RunTurnOptions): Promise<string> {
  const { client, model, input, registry, confirm } = opts;
  const tools = toolSchemas(registry);

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.responses.create({ model, input, tools });

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );

    if (calls.length === 0) {
      return response.output_text;
    }

    for (const call of calls) {
      input.push(call);
      const tool = registry[call.name];
      let result: string;

      if (!tool) {
        result = `Error: unknown tool "${call.name}"`;
      } else {
        const args = JSON.parse(call.arguments) as Record<string, unknown>;
        if (RISKY.has(call.name)) {
          const allowed = await confirm(`${call.name}(${call.arguments})`);
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
