import { readFile } from "node:fs/promises";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ModelRoute, ModelRouteRequest } from "@earendil-works/pi-coding-agent";

export interface Member {
  provider: string;
  id: string;
}
export interface Alloy {
  name: string;
  members: string[];
}
export interface Config {
  models: Record<string, Member>;
  alloys: Record<string, Alloy>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a nonempty string`);
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: unknown field "${key}"`);
  }
}

export function parseConfig(value: unknown): Config {
  const root = object(value, "config");
  fields(root, ["models", "alloys"], "config");
  const models = Object.create(null) as Config["models"];
  for (const [alias, raw] of Object.entries(object(root.models, "models"))) {
    text(alias, "model alias");
    const member = object(raw, `models.${alias}`);
    fields(member, ["provider", "id"], `models.${alias}`);
    models[alias] = {
      provider: text(member.provider, `models.${alias}.provider`),
      id: text(member.id, `models.${alias}.id`),
    };
  }
  const alloys = Object.create(null) as Config["alloys"];
  for (const [id, raw] of Object.entries(object(root.alloys, "alloys"))) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`Invalid alloy ID "${id}"`);
    const alloy = object(raw, `alloys.${id}`);
    fields(alloy, ["name", "members"], `alloys.${id}`);
    if (!Array.isArray(alloy.members) || !alloy.members.length) {
      throw new Error(`alloy/${id}: members must be a nonempty array`);
    }
    const members = alloy.members.map((alias: unknown) => {
      const name = text(alias, `alloy/${id} member`);
      if (!Object.hasOwn(models, name)) throw new Error(`alloy/${id}: unknown member "${name}"`);
      return name;
    });
    if (new Set(members).size !== members.length) {
      throw new Error(`alloy/${id}: duplicate members are not allowed; every model must have equal probability`);
    }
    const targets = members.map((alias) => `${models[alias].provider}/${models[alias].id}`);
    if (new Set(targets).size !== targets.length) {
      throw new Error(`alloy/${id}: aliases must refer to distinct models`);
    }
    alloys[id] = { name: text(alloy.name, `alloy/${id}.name`), members };
  }
  if (!Object.keys(alloys).length) throw new Error("alloys must contain at least one named alloy");
  return { models, alloys };
}

export async function loadConfig(path: string): Promise<Config> {
  try {
    return parseConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    throw new Error(`Pi Alloy config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function memberLabel(config: Config, alloyId: string, member: Member): string {
  const alias = config.alloys[alloyId]?.members.find((name) => {
    const candidate = config.models[name];
    return candidate.provider === member.provider && candidate.id === member.id;
  });
  return `alloy/${alloyId} → ${alias ? `"${alias}" ` : ""}(${member.provider}/${member.id})`;
}

/** Validate the whole blend, then draw once. Never probe APIs or silently drop members. */
export async function routeAlloy(
  config: Config,
  alloyId: string,
  request: ModelRouteRequest,
  registry: Pick<ExtensionContext["modelRegistry"], "find" | "getApiKeyAndHeaders">,
  random: () => number = Math.random,
): Promise<ModelRoute> {
  const alloy = config.alloys[alloyId];
  const resolved = [];
  for (const alias of alloy.members) {
    request.signal?.throwIfAborted();
    const member = config.models[alias];
    const label = memberLabel(config, alloyId, member);
    const model = registry.find(member.provider, member.id);
    if (!model) throw new Error(`${label}: model is not in Pi's catalog. Fix the member or remove it from this alloy.`);
    if (model.api === "pi-virtual") throw new Error(`${label}: members must be physical models, not virtual models.`);
    try {
      const auth = await registry.getApiKeyAndHeaders(model);
      if (!auth.ok) throw new Error(`No usable credentials: ${auth.error}`);
    } catch (error) {
      throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}. Configure credentials or remove this member.`);
    }
    resolved.push(model);
  }
  request.signal?.throwIfAborted();
  // A retry must never reroll into another member, even if the blend has been edited.
  if (request.reason === "retry" && request.failed) {
    const failed = request.failed;
    const model = resolved.find((candidate) => candidate.provider === failed.model.provider && candidate.id === failed.model.id);
    if (!model) throw new Error(`alloy/${alloyId}: failed member ${failed.model.provider}/${failed.model.id} is no longer in the alloy; retry cancelled.`);
    return { model, thinkingLevel: failed.thinkingLevel ?? request.thinkingLevel };
  }
  const index = Math.floor(random() * resolved.length);
  return { model: resolved[index], thinkingLevel: request.thinkingLevel };
}

/** Only decorate errors: native Pi retains authority over retry/overflow classification. */
export function annotateError(config: Config, alloyId: string, message: AssistantMessage): AssistantMessage {
  if (message.stopReason !== "error" || !message.errorMessage) return message;
  if (message.provider === "alloy" || !config.alloys[alloyId]?.members.some((alias) => {
    const member = config.models[alias];
    return member.provider === message.provider && member.id === message.model;
  })) return message;
  const prefix = `${memberLabel(config, alloyId, { provider: message.provider, id: message.model })}:\n`;
  if (message.errorMessage.startsWith(prefix)) return message;
  return { ...message, errorMessage: prefix + message.errorMessage };
}
