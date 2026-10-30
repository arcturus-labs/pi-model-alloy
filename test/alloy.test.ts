import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRouteRequest } from "@earendil-works/pi-coding-agent";
import { annotateError, loadConfig, parseConfig, routeAlloy } from "../src/alloy.ts";

const raw = {
  models: { a: { provider: "alpha", id: "one" }, b: { provider: "beta", id: "two" }, c: { provider: "gamma", id: "three" } },
  alloys: { test: { name: "Test Alloy", members: ["a", "b", "c"] } },
};
const config = parseConfig(raw);
type Registry = Parameters<typeof routeAlloy>[3];
const model = (provider: string, id: string) => ({ provider, id, api: "openai-completions" }) as ReturnType<ExtensionContext["modelRegistry"]["find"]>;
const registry: Registry = { find: model, getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test" }) };
const request = (reason: ModelRouteRequest["reason"] = "user"): ModelRouteRequest => ({
  model: model("alloy", "test")!, thinkingLevel: "high", reason, messages: [],
});
const failure = (errorMessage = "503 server overloaded"): AssistantMessage => ({
  role: "assistant", provider: "beta", model: "two", api: "openai-completions", content: [],
  stopReason: "error", errorMessage, timestamp: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

test("configuration accepts named blends and the shipped example", async () => {
  assert.equal(config.alloys.test.name, "Test Alloy");
  assert.equal((await loadConfig(new URL("../alloys.example.json", import.meta.url).pathname)).alloys.budget.members.length, 3);
});

test("invalid config fails with actionable errors", () => {
  for (const [value, pattern] of [
    [null, /must be an object/],
    [{ ...raw, typo: true }, /unknown field/],
    [{ ...raw, alloys: {} }, /at least one/],
    [{ ...raw, alloys: { test: { name: "Test", members: [] } } }, /nonempty array/],
    [{ ...raw, alloys: { test: { name: "Test", members: ["typo"] } } }, /unknown member/],
    [{ ...raw, alloys: { test: { name: "Test", members: ["a", "a"] } } }, /duplicate/],
    [{ ...raw, alloys: { "bad/id": raw.alloys.test } }, /Invalid alloy ID/],
    [{ ...raw, models: { ...raw.models, b: raw.models.a } }, /distinct models/],
    [{ ...raw, models: { ...raw.models, a: { ...raw.models.a, thinking: "high" } } }, /unknown field/],
  ] as const) assert.throws(() => parseConfig(value), pattern);
});

test("missing and malformed config report the path", async () => {
  await assert.rejects(loadConfig("/definitely/not/an/alloy/file"), /Pi Alloy config.*ENOENT/);
  assert.ok(await readFile(new URL("../src/extension.ts", import.meta.url), "utf8"));
});

test("each ordinary reason samples uniform intervals, passes thinking, and allows repeats", async () => {
  for (const reason of ["user", "continuation", "direct"] as const) {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const route = await routeAlloy(config, "test", request(reason), registry, () => (i + 0.5) / 300);
      counts[route.model.provider] = (counts[route.model.provider] ?? 0) + 1;
      assert.equal(route.thinkingLevel, "high");
    }
    assert.deepEqual(counts, { alpha: 100, beta: 100, gamma: 100 });
  }
  const first = await routeAlloy(config, "test", request(), registry, () => 0);
  const second = await routeAlloy(config, "test", { ...request("continuation"), previous: first }, registry, () => 0);
  assert.equal(second.model.id, first.model.id);
});

test("validate every member before drawing, even when a healthy one would be selected", async () => {
  let draws = 0;
  const missing: Registry = { ...registry, getApiKeyAndHeaders: async (m) => m.provider === "beta" ? { ok: false, error: "Missing BETA_API_KEY" } : { ok: true } };
  await assert.rejects(routeAlloy(config, "test", request(), missing, () => { draws++; return 0; }), /alloy\/test.*"b".*beta\/two.*No usable credentials: Missing BETA_API_KEY/);
  assert.equal(draws, 0);
});

test("unknown model, nested virtual model, and auth exception fail without fallback", async () => {
  await assert.rejects(routeAlloy(config, "test", request(), { ...registry, find: () => undefined }), /not in Pi's catalog/);
  await assert.rejects(routeAlloy(config, "test", request(), { ...registry, find: () => ({ ...model("alloy", "nested"), api: "pi-virtual" }) as ReturnType<Registry["find"]> }), /physical models/);
  await assert.rejects(routeAlloy(config, "test", request(), { ...registry, getApiKeyAndHeaders: async () => { throw new Error("login expired"); } }), /alloy\/test.*login expired/);
});

test("retries retain the failed model and thinking without drawing", async () => {
  const retry = { ...request("retry"), failed: { model: model("beta", "two")!, thinkingLevel: "low" as const, message: failure() } };
  const route = await routeAlloy(config, "test", retry, registry, () => { throw new Error("must not draw"); });
  assert.equal(route.model.provider, "beta");
  assert.equal(route.thinkingLevel, "low");
  const changed = parseConfig({ ...raw, alloys: { test: { name: "Test", members: ["a"] } } });
  await assert.rejects(routeAlloy(changed, "test", retry, registry), /no longer in the alloy/);
});

test("abort interrupts validation and never draws", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(routeAlloy(config, "test", { ...request(), signal: controller.signal }, registry), /abort/i);
});

test("errors retain original provider payload and gain alloy/member identity exactly once", () => {
  for (const error of ["503 server overloaded", "429 insufficient_quota", "subscription_sharing_usage_limit_exceeded", "401 Invalid API key"]) {
    const original = failure(error);
    const decorated = annotateError(config, "test", original);
    assert.equal(decorated.errorMessage, `alloy/test → "b" (beta/two):\n${error}`);
    assert.equal(annotateError(config, "test", decorated), decorated);
    assert.equal(original.errorMessage, error);
    assert.equal(decorated.stopReason, "error");
  }
  const success = { ...failure(), stopReason: "stop" as const };
  assert.equal(annotateError(config, "test", success), success);
  const unrelated = { ...failure(), provider: "other" };
  assert.equal(annotateError(config, "test", unrelated), unrelated);
});
