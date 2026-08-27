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

export interface MultiTurnCase {
  name: string;
  prompt: string;
  expectedToolOrder: string[];
  verifyFile?: string;
  judgeQuestion: string;
}

export const multiTurnCases: MultiTurnCase[] = [
  {
    name: "write then run",
    prompt: "Write a python script primes.py that prints the first 5 primes, then run it.",
    expectedToolOrder: ["write_file", "run_command"],
    verifyFile: "primes.py",
    judgeQuestion: "write a script and run it, printing prime numbers",
  },
];
