import "dotenv/config";
import OpenAI from "openai";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runTurn } from "./loop.ts";
import { createToolRegistry } from "./tools/index.ts";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL,
});
const model = process.env.OPENROUTER_MODEL!;
const registry = createToolRegistry({ client, model });

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const alwaysAllow = new Set<string>();
  const confirm = async (toolName: string, description: string): Promise<boolean> => {
    if (alwaysAllow.has(toolName)) return true;
    const answer = await rl.question(`I'd like to ${description}. Allow? (y/n/a=always allow ${toolName}) › `);
    const normalized = answer.trim().toLowerCase();
    if (normalized === "a") {
      alwaysAllow.add(toolName);
      return true;
    }
    return normalized === "y";
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
