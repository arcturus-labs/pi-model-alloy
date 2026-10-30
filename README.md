# pi-model-alloy

Uniform random model alloys for Pi, after [XBOW's alloy agents](https://xbow.com/blog/alloy-agents).

One shared conversation. Each request is routed to one randomly chosen member. Repeats allowed. No extra model calls.

## Install

```bash
mkdir -p ~/.pi/agent
cp alloys.example.json ~/.pi/agent/alloys.json
# edit members to match your catalog, then either:
pi install ./pi-model-alloy
# or one-off:
pi -e ./pi-model-alloy/src/extension.ts
```

`PI_ALLOY_CONFIG` overrides the config path (useful for testing).

## Configure

```json
{
  "models": {
    "sol": { "provider": "openai-codex", "id": "gpt-6.1-sol" },
    "sonnet": { "provider": "claude-bridge", "id": "claude-sonnet-5-5" }
  },
  "alloys": {
    "duet": { "name": "Sol + Sonnet", "members": ["sol", "sonnet"] }
  }
}
```

- `models`: named aliases → exact `provider`/`id`. Swap one alias to upgrade every alloy.
- `alloys`: `id` → stable model ID (`alloy/duet`); `name` → picker label; `members` → aliases, each with equal probability.
- No weights, no per-member thinking levels, no silent skipping.

## Use

- `/model` → search the alloy `name` → select. No default or `enabledModels` change needed (add to `enabledModels` only for `Ctrl+P` cycling).
- `/thinking` applies to whichever member answers, clamped to its supported levels.
- `/reload` picks up config edits.
- Footer/`/session` show the physical model that answered.

## Behavior

- Every member is validated (catalog presence, physical not virtual, resolvable credentials) **before** sampling. One bad member fails the request with `alloy/<id> → "alias" (provider/id): <cause>` — never silent fallback, never probe calls.
- Automatic retries stay on the failed member. Other requests (user, tool follow-ups, compaction) resample.
- Persistent errors (quota, invalid key, usage window) surface unchanged, prefixed once with alloy/member identity. Pi keeps authority over retry/overflow classification.

## Dev setup

```bash
npm install   # postinstall symlinks host Pi packages for typecheck
npm run typecheck
npm test
```

Missing-credential check (isolated, no session writes):

```bash
env -u ZAI_API_KEY PI_ALLOY_CONFIG=/tmp/alloy-rate.json \
  pi -e ./src/extension.ts --model alloy/budget --no-session -p 'Say exactly: routed OK'
```
