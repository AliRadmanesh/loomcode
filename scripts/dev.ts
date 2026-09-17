import { existsSync } from "node:fs";

const week = process.argv[2];
const target = week ? `${week}/src/agent.ts` : "src/agent.ts";

if (!existsSync(target)) {
  console.error(`No agent found at ${target}`);
  process.exit(1);
}

const proc = Bun.spawn(["bun", "run", target], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await proc.exited);
