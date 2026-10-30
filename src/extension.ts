import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { annotateError, loadConfig, routeAlloy } from "./alloy.ts";

export default async function (pi: ExtensionAPI) {
  const override = process.env.PI_ALLOY_CONFIG;
  const path = override
    ? override.startsWith("~/") ? join(homedir(), override.slice(2)) : isAbsolute(override) ? override : resolve(override)
    : join(getAgentDir(), "alloys.json");
  // Read once per extension runtime. /reload replaces registrations and loads a fresh config.
  const config = await loadConfig(path);
  for (const [id, alloy] of Object.entries(config.alloys)) {
    pi.registerVirtualModel({
      provider: "alloy",
      id,
      name: alloy.name,
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
      async route(request, ctx) {
        return routeAlloy(config, id, request, ctx.modelRegistry);
      },
    });
  }
  pi.on("message_end", (event, ctx) => {
    if (ctx.model?.provider !== "alloy" || event.message.role !== "assistant") return;
    const message = annotateError(config, ctx.model.id, event.message);
    if (message !== event.message) return { message };
  });
}
