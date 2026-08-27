import "dotenv/config";
import OpenAI from "openai";
import { createToolRegistry, toolSchemas } from "../tools/index.ts";
import { singleTurnCases } from "./cases.ts";

export interface EvalResult {
  name: string;
  passed: boolean;
  detail: string;
}

export async function runSingleTurnEval(client: OpenAI, model: string): Promise<EvalResult[]> {
  const registry = createToolRegistry({ client, model });
  const tools = toolSchemas(registry);
  const results: EvalResult[] = [];

  for (const c of singleTurnCases) {
    const response = await client.responses.create({ model, input: c.prompt, tools });
    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call",
    );
    const calledTool = calls[0]?.name ?? null;
    results.push({
      name: c.name,
      passed: calledTool === c.expectedTool,
      detail: `expected ${c.expectedTool ?? "no tool"}, got ${calledTool ?? "no tool"}`,
    });
  }
  return results;
}

async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });
  const model = process.env.OPENROUTER_MODEL!;

  const results = await runSingleTurnEval(client, model);
  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} - ${r.name} (${r.detail})`);
  }
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n${passedCount}/${results.length} passed`);
}

main();
