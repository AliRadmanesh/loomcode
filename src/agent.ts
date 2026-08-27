import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL,
});

async function main() {
  const response = await client.responses.create({
    model: "openai/gpt-4o-mini",
    input: "What is the capital of France? Answer in one word.",
  });

  console.log(response.output_text);
}

main();
