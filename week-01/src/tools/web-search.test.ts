import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { createWebSearchTool } from "./web-search.ts";

test("returns the model's output_text and passes the web plugin", async () => {
  let capturedParams: unknown;
  const fakeClient = {
    responses: {
      create: async (params: unknown) => {
        capturedParams = params;
        return { output_text: "Node 24, 23, 22", output: [] };
      },
    },
  } as unknown as OpenAI;

  const tool = createWebSearchTool({ client: fakeClient, model: "m" });
  const result = await tool.execute({ query: "latest node versions" });

  expect(result).toBe("Node 24, 23, 22");
  expect(capturedParams).toMatchObject({
    plugins: [{ id: "web", max_results: 5 }],
  });
});

test("returns an Error string instead of throwing on failure", async () => {
  const fakeClient = {
    responses: {
      create: async () => {
        throw new Error("network down");
      },
    },
  } as unknown as OpenAI;

  const tool = createWebSearchTool({ client: fakeClient, model: "m" });
  const result = await tool.execute({ query: "x" });

  expect(result).toBe("Error: network down");
});
