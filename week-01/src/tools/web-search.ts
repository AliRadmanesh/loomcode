import type OpenAI from "openai";
import type { Tool } from "./index.ts";

export interface WebSearchDeps {
  client: OpenAI;
  model: string;
}

export function createWebSearchTool({ client, model }: WebSearchDeps): Tool {
  return {
    name: "web_search",
    description: "Search the web for current or external information and return a concise answer.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for." } },
      required: ["query"],
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const query = String(args.query ?? "");
      try {
        const response = await client.responses.create({
          model,
          input: `Search the web and answer concisely: ${query}`,
          plugins: [{ id: "web", max_results: 5 }],
        } as OpenAI.Responses.ResponseCreateParamsNonStreaming & {
          plugins: Array<{ id: "web"; max_results?: number }>;
        });
        return response.output_text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
