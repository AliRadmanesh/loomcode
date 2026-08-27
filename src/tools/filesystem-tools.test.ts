import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile as fsReadFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileTool } from "./write-file.ts";
import { readFileTool } from "./read-file.ts";
import { editFileTool } from "./edit-file.ts";
import { listFilesTool } from "./list-files.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-fs-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("write_file creates a file with the given content", async () => {
  const path = join(dir, "hello.txt");
  const result = await writeFileTool.execute({ path, content: "hi" });
  expect(result).toContain(path);
  expect(await fsReadFile(path, "utf8")).toBe("hi");
});

test("write_file overwrites an existing file", async () => {
  const path = join(dir, "hello.txt");
  await writeFileTool.execute({ path, content: "first" });
  await writeFileTool.execute({ path, content: "second" });
  expect(await fsReadFile(path, "utf8")).toBe("second");
});

test("read_file returns the file's contents", async () => {
  const path = join(dir, "hello.txt");
  await writeFileTool.execute({ path, content: "hi" });
  const result = await readFileTool.execute({ path });
  expect(result).toBe("hi");
});

test("read_file on a missing path returns an Error string, not a throw", async () => {
  const result = await readFileTool.execute({ path: join(dir, "missing.txt") });
  expect(result).toStartWith("Error:");
});

test("edit_file replaces the first occurrence of oldString", async () => {
  const path = join(dir, "primes.py");
  await writeFileTool.execute({ path, content: "print first 20 primes" });
  const result = await editFileTool.execute({ path, oldString: "20", newString: "50" });
  expect(result).toBe(`Edited ${path}`);
  expect(await fsReadFile(path, "utf8")).toBe("print first 50 primes");
});

test("edit_file returns an Error string when oldString isn't found", async () => {
  const path = join(dir, "primes.py");
  await writeFileTool.execute({ path, content: "print first 20 primes" });
  const result = await editFileTool.execute({ path, oldString: "999", newString: "50" });
  expect(result).toBe(`Error: oldString not found in ${path}`);
  expect(await fsReadFile(path, "utf8")).toBe("print first 20 primes");
});

test("edit_file on a missing file returns an Error string", async () => {
  const result = await editFileTool.execute({
    path: join(dir, "missing.py"),
    oldString: "a",
    newString: "b",
  });
  expect(result).toStartWith("Error:");
});

test("list_files lists entries in a directory", async () => {
  await writeFileTool.execute({ path: join(dir, "a.txt"), content: "" });
  await writeFileTool.execute({ path: join(dir, "b.txt"), content: "" });
  const result = await listFilesTool.execute({ dir });
  expect(result.split("\n").sort()).toEqual(["a.txt", "b.txt"]);
});

test("list_files on a missing directory returns an Error string", async () => {
  const result = await listFilesTool.execute({ dir: join(dir, "nope") });
  expect(result).toStartWith("Error:");
});
