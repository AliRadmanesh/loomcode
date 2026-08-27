import "dotenv/config";
import OpenAI from "openai";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runTurn } from "./loop.ts";
import type { ToolRegistry } from "./tools/index.ts";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL,
});
const model = process.env.OPENROUTER_MODEL!;
const registry: ToolRegistry = {};

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const confirm = async (description: string): Promise<boolean> => {
    const answer = await rl.question(`I'd like to ${description}. Allow? (y/n) › `);
    return answer.trim().toLowerCase() === "y";
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [];

  while (true) {
    const line = await rl.question("you › ");
    if (!line.trim()) continue;
    input.push({ role: "user", content: line });
    const answer = await runTurn({ client, model, input, registry, confirm });
    console.log(`agent › ${answer}`);
  }
}

main();
