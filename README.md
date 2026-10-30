# pi-model-alloy

Uniform random model alloys for Pi, after [XBOW's alloy agents](https://xbow.com/blog/alloy-agents).

One shared conversation. Each request is routed to one randomly chosen member. Repeats allowed. No extra model calls.

> **Easiest setup:** tell your agent to read the setup guide and follow it:
> `https://raw.githubusercontent.com/arcturus-labs/pi-model-alloy/main/DEAR_AGENT.md`
> It inspects your Pi models, recommends alloys, validates them, and writes the config with your approval.

## Install

**From npm** (recommended):

```bash
pi install npm:@arcturus-labs/pi-model-alloy
```

This adds the package to `~/.pi/agent/settings.json`, so every Pi session loads the extension automatically. To remove it later: `pi remove npm:@arcturus-labs/pi-model-alloy`.

You still need a config file — see [Configure](#configure) below, or have your agent do it via the guide above.

**From source:** clone the repo, then:

```bash
cd pi-model-alloy
cp alloys.example.json ~/.pi/agent/alloys.json  # once; edit members to match your catalog
pi install ./
```

**Try it once** without installing:

```bash
pi -e /path/to/pi-model-alloy/src/extension.ts
```

The `-e` flag loads the extension for that invocation only; nothing is written to settings.

## Configure

Config file: `~/.pi/agent/alloys.json` (create it with the `cp` above; `PI_ALLOY_CONFIG` env var overrides the path, useful for testing).

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

Two sections:

- `models`: short aliases → exact `provider`/`id` pairs from Pi's catalog (check IDs with `pi --list-models <name>`). Swap one alias to upgrade every alloy that uses it.
- `alloys`: one entry per blend. The key (`duet`) becomes the stable model ID (`alloy/duet`); `name` is the label shown in `/model`; `members` lists aliases, each drawn with equal probability per request.

Rules: at least one alloy; members must be nonempty, reference defined aliases, contain no duplicates, and resolve to distinct physical models (no virtual models as members). Violations fail fast with the file path and cause. No weights, no per-member thinking levels, no silent skipping.

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
