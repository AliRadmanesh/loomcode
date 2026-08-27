export interface SingleTurnCase {
  name: string;
  prompt: string;
  expectedTool: string | null;
}

export const singleTurnCases: SingleTurnCase[] = [
  { name: "arithmetic (no tool)", prompt: "What is 2+2?", expectedTool: null },
  { name: "web search", prompt: "Search for the latest React version.", expectedTool: "web_search" },
  { name: "write file", prompt: "Create hello.txt with 'hi' inside.", expectedTool: "write_file" },
];
