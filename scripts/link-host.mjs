#!/usr/bin/env node
// Dev-only: symlink host-provided Pi packages so `npm run typecheck` resolves types.
// Pi supplies these at runtime via its extension module mapping; they must stay
// out of `dependencies` (see docs/packages.md). Safe to run repeatedly.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scope = join(root, "node_modules", "@earendil-works");

function piDir() {
  try {
    const cli = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    const target = execFileSync("readlink", [cli], { encoding: "utf8" }).trim();
    // <pi>/dist/bundle/cli.js -> <pi>/../..
    const dist = resolve(dirname(cli), target);
    return resolve(dist, "..", "..", "..");
  } catch {
    return null;
  }
}

const dir = piDir();
if (!dir || !existsSync(join(dir, "package.json"))) {
  console.log("link-host: pi installation not found; skipping (runtime provides host packages).");
  process.exit(0);
}
mkdirSync(scope, { recursive: true });
for (const [name, sub] of [
  ["pi-coding-agent", "."],
  ["pi-ai", "node_modules/@earendil-works/pi-ai"],
]) {
  const from = join(dir, sub);
  const to = join(scope, name);
  if (!existsSync(from)) {
    console.log(`link-host: ${from} not found; skipping ${name}.`);
    continue;
  }
  rmSync(to, { recursive: true, force: true });
  symlinkSync(from, to, "dir");
  console.log(`link-host: ${to} -> ${from}`);
}
