import { test, expect } from "bun:test";
import type OpenAI from "openai";
import { runTurn, MAX_STEPS, type ResponsesClient } from "./loop.ts";
import type { Tool, ToolRegistry } from "./tools/index.ts";

function fakeResponse(
  outputText: string,
  calls: Array<{ name: string; args: Record<string, unknown>; call_id: string }> = [],
): { output: OpenAI.Responses.ResponseOutputItem[]; output_text: string } {
  const output = calls.map((c) => ({
    type: "function_call" as const,
    call_id: c.call_id,
    name: c.name,
    arguments: JSON.stringify(c.args),
  }));
  return { output: output as unknown as OpenAI.Responses.ResponseOutputItem[], output_text: outputText };
}

test("stop rule: no function_call means print and return", async () => {
  const client: ResponsesClient = {
    responses: {
      create: async () => fakeResponse("Tokyo"),
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "capital of Japan?" }];
  const answer = await runTurn({ client, model: "m", input, registry: {}, confirm: async () => true });
  expect(answer).toBe("Tokyo");
  expect(input).toHaveLength(1);
});

test("threads a function_call and its output into input, then stops", async () => {
  let calls = 0;
  const echoTool: Tool = {
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: async (args) => `echoed:${JSON.stringify(args)}`,
  };
  const registry: ToolRegistry = { echo: echoTool };
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        calls++;
        if (calls === 1) return fakeResponse("", [{ name: "echo", args: { x: 1 }, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const confirmCalls: string[] = [];
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry,
    confirm: async (d) => {
      confirmCalls.push(d);
      return true;
    },
  });
  expect(answer).toBe("done");
  expect(confirmCalls).toHaveLength(0); // echo isn't risky
  expect(input).toHaveLength(3); // user message, function_call, function_call_output
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.type).toBe("function_call_output");
  expect(outputItem.call_id).toBe("call_1");
  expect(outputItem.output).toBe('echoed:{"x":1}');
});

test("unknown tool name produces an Error string, never throws", async () => {
  let call = 0;
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        call++;
        if (call === 1) return fakeResponse("", [{ name: "bogus", args: {}, call_id: "call_1" }]);
        return fakeResponse("done");
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const answer = await runTurn({ client, model: "m", input, registry: {}, confirm: async () => true });
  expect(answer).toBe("done");
  const outputItem = input[2]! as OpenAI.Responses.ResponseInputItem.FunctionCallOutput;
  expect(outputItem.output).toBe('Error: unknown tool "bogus"');
});

test("step cap: gives up after MAX_STEPS if the model never stops calling tools", async () => {
  let createCalls = 0;
  const echoTool: Tool = {
    name: "echo",
    description: "echo",
    parameters: { type: "object", properties: {} },
    execute: async () => "echoed",
  };
  const client: ResponsesClient = {
    responses: {
      create: async () => {
        createCalls++;
        return fakeResponse("", [{ name: "echo", args: {}, call_id: `call_${createCalls}` }]);
      },
    },
  };
  const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: "go" }];
  const answer = await runTurn({
    client,
    model: "m",
    input,
    registry: { echo: echoTool },
    confirm: async () => true,
  });
  expect(createCalls).toBe(MAX_STEPS);
  expect(answer).toContain(`${MAX_STEPS}`);
});
