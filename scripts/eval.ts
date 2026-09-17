import { existsSync } from "node:fs";

const week = process.argv[2] ?? "week-01";
const target = `${week}/src/eval/eval.ts`;

if (!existsSync(target)) {
  console.error(`No eval suite found at ${target}`);
  process.exit(1);
}

const proc = Bun.spawn(["bun", "run", target], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
