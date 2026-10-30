# DEAR_AGENT.md — How to set up pi-model-alloy for this user

You are helping the user configure **pi-model-alloy** (uniform random model alloys for Pi).
Do not change code unless asked. Your job is configuration + validation + recommendation.

## 0. Understand the idea first

Read this before recommending anything:

- https://xbow.com/blog/alloy-agents

Key philosophy to carry into your recommendations:

- One shared conversation, one model call per step, but the model is drawn **uniformly at random** from the blend on every request (repeats allowed).
- Goal is **higher quality at the same call count**, not lower cost. The alloy costs ~the mean of its members plus extra cache-miss overhead.
- Best alloys per XBOW: models of **about the same strength but from different foundation companies / providers** (low correlation in what each is good at). Same-provider pairs (e.g. Sonnet + Haiku) just average out. A much weaker member can drag the alloy down.
- No routing intelligence, no judge, no fallback. One bad member fails the request loudly — that is intentional.

## 1. Inspect the user's current Pi setup

1. Read `~/.pi/agent/settings.json` — note `defaultModel` and `enabledModels` (these are `provider/id:thinking` entries; thinking suffix is Pi-level, not part of the model ID).
2. Read `~/.pi/agent/models.json` — custom providers/models the user added.
3. Run `pi --list-models` (or `pi --list-models <search>`) to see the real catalog. Treat this as ground truth for IDs.
4. Optionally check credentials: `pi auth check --provider <provider> [--no-refresh]`.

Do NOT change `defaultModel` or `enabledModels` unless the user asks. Alloys work without either.

## 2. Recommend useful alloys

Rules:

- Each member must be an exact `provider`/`id` pair from the catalog.
- Prefer **same-tier, different-provider** blends (e.g. strong OpenAI-codex + strong Claude-bridge + strong Meta/ZAI/DeepSeek, or a separate budget trio).
- 2–3 members per alloy is a good default. More members = more diversity but more cache misses.
- Give each alloy a stable ID (e.g. `duet`, `trio`, `budget`) and a human `name` (e.g. `"Sol + Sonnet"`).
- Keep the user's existing thinking levels in mind, but note v1 has no per-member thinking: `/thinking` applies to whichever member answers.

Propose 2–4 concrete blends with a one-line rationale each (e.g. "strongest OpenAI × strongest Anthropic — different labs, same tier").

Then **ask the user which to keep**, and invite their own combinations. Do not write config until they confirm.

## 3. Validate every member before writing config

For each proposed member:

1. `pi --list-models <id-fragment>` must show that exact `provider/id`.
2. `pi auth check --provider <provider>` should be `ready` (warn — don't block — if not ready; the extension will error clearly at runtime).
3. Never put secrets in the config. Only `provider` + `id`.

## 4. Write `~/.pi/agent/alloys.json`

Location: `~/.pi/agent/alloys.json` (`PI_ALLOY_CONFIG` env var overrides this path — useful for testing, not for permanent setup).

Format:

```json
{
  "models": {
    "sol":    { "provider": "openai-codex",  "id": "gpt-6.1-sol" },
    "sonnet": { "provider": "claude-bridge", "id": "claude-sonnet-5-5" }
  },
  "alloys": {
    "duet": { "name": "Sol + Sonnet", "members": ["sol", "sonnet"] }
  }
}
```

- `models`: short alias → exact catalog pair. Reuse aliases across alloys so one edit upgrades everything.
- `alloys`: key → stable model ID (`alloy/duet`); `name` → `/model` picker label; `members` → aliases, each drawn with equal probability per request.
- Constraints the extension enforces: nonempty members, defined aliases, no duplicates, distinct physical models, no virtual models as members.

Back up any existing file first (`cp ~/.pi/agent/alloys.json ~/.pi/agent/alloys.json.bak`).

## 5. Get the code and load the extension

The package is not on npm. Clone it (ask the user where they want it if no checkout exists):

```bash
git clone https://github.com/arcturus-labs/pi-model-alloy /path/they/choose/pi-model-alloy
cd /path/they/choose/pi-model-alloy
```

All commands below use that checkout path.

**Try once** (writes nothing to settings):

```bash
pi -e /path/to/pi-model-alloy/src/extension.ts
```

**Install permanently** (adds to `~/.pi/agent/settings.json` packages; every session loads it):

```bash
cd /path/to/pi-model-alloy
cp alloys.example.json ~/.pi/agent/alloys.json   # only if starting fresh
pi install ./
```

To remove: `pi remove pi-model-alloy`.

(If this package is ever published to npm, prefer `pi install npm:pi-model-alloy` and update this section.)

## 6. Verify it works

1. `pi --list-models alloy` must list each `alloy/<id>` with its name.
2. Quick routing check (no session writes):
   ```bash
   pi --model alloy/<id> --no-session -p 'Say exactly: routed OK'
   ```
3. In an interactive session: `/model` → pick the alloy by name → send a few messages → `/session` should show cost split across the physical member models. The footer shows the routed model next to the alloy selection.
4. Config edits take effect on `/reload` (no restart needed).

## 7. Troubleshooting (tell the user, don't silently work around)

- `alloy/<id> → "alias" (provider/id): No usable credentials...` — that member lacks credentials. Configure them or remove the member. The extension never skips a bad member.
- `... not in Pi's catalog` — the `provider/id` is wrong or the catalog changed. Re-check with `pi --list-models`.
- `... members must be physical models` — alloys can't nest. Point at a real model.
- Alloy missing from `/model` — extension not loaded (check `pi list` / settings `packages`) or `alloys.json` has a parse/validation error (Pi logs the path and cause at startup).
- Thinking behavior: `/thinking <level>` requests that level from whichever member answers, clamped to what it supports. There are no per-member thinking settings in v1.

## What NOT to do

- Don't store API keys, tokens, or credentials anywhere in `alloys.json` or the repo.
- Don't add alloys to `enabledModels` unless the user wants them in `Ctrl+P` cycling — `/model` finds them regardless.
- Don't "fix" a failing member by silently dropping it. Surface the error and let the user decide.
- Don't run `tmux kill-server` or touch the user's live sessions/terminals for testing. Use `--no-session` one-shot runs.
