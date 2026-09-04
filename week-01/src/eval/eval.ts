import "dotenv/config";
import OpenAI from "openai";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolRegistry, toolSchemas } from "../tools/index.ts";
import { runTurn } from "../loop.ts";
import type { Tool, ToolRegistry } from "../tools/index.ts";
import { mockWebSearchTool, mockRunCommandTool } from "./mock-tools.ts";
import { judge } from "./judge.ts";
import { singleTurnCases, multiTurnCases } from "./cases.ts";

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

function wrapWithCallLog(registry: ToolRegistry, log: string[]): ToolRegistry {
  const wrapped: ToolRegistry = {};
  for (const [name, tool] of Object.entries(registry)) {
    wrapped[name] = {
      ...tool,
      execute: async (args) => {
        log.push(name);
        return tool.execute(args);
      },
    } satisfies Tool;
  }
  return wrapped;
}

export async function runMultiTurnEval(
  client: OpenAI,
  model: string,
  judgeModel: string,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const c of multiTurnCases) {
    const dir = await mkdtemp(join(tmpdir(), "agent-eval-"));
    const originalCwd = process.cwd();
    process.chdir(dir);

    try {
      const baseRegistry = createToolRegistry({ client, model });
      baseRegistry.web_search = mockWebSearchTool;
      baseRegistry.run_command = mockRunCommandTool;
      const calledOrder: string[] = [];
      const registry = wrapWithCallLog(baseRegistry, calledOrder);

      const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: c.prompt }];
      const answer = await runTurn({ client, model, input, registry, confirm: async () => true });

      const orderOk = c.expectedToolOrder.every((name, i) => calledOrder[i] === name);
      const fileOk = c.verifyFile ? existsSync(join(dir, c.verifyFile)) : true;
      const evidence =
        c.verifyFile && fileOk ? `Contents of ${c.verifyFile}:\n${await readFile(join(dir, c.verifyFile), "utf8")}` : undefined;
      const judgeOk = await judge(client, judgeModel, c.judgeQuestion, answer, evidence);

      results.push({
        name: c.name,
        passed: orderOk && fileOk && judgeOk,
        detail: `order=${calledOrder.join(",")}, fileOk=${fileOk}, judgeOk=${judgeOk}, answer=${answer}`,
      });
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
  }

  return results;
}

async function main() {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL,
  });
  const model = process.env.OPENROUTER_MODEL!;
  const judgeModel = process.env.OPENROUTER_JUDGE_MODEL!;

  const results = [
    ...(await runSingleTurnEval(client, model)),
    ...(await runMultiTurnEval(client, model, judgeModel)),
  ];

  for (const r of results) {
    console.log(`${r.passed ? "PASS" : "FAIL"} - ${r.name} (${r.detail})`);
  }
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`\n${passedCount}/${results.length} passed`);
}

main();
