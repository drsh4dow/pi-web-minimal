# pi-web-minimal

Web research for Pi agents without trashing the context window.

LLMs research badly: a single `fetch` or search dump can blow 50k tokens of HTML, ads, and nav chrome into context, evicting the actual work. This package wraps Exa + Context7 behind tools that **store raw results out-of-band and return a short, source-cited brief**. The agent gets evidence; you keep your context budget.

Suckless by design. No browser session, no curator UI, no PDF/video pipeline, no provider zoo.

## How

Two-stage pipeline per call:

1. **Retrieve** via Exa / Context7 / git clone. Full payload written to disk under a `responseId`.
2. **Distill** before returning:
   - Small payloads → deterministic compaction (no model call).
   - Larger payloads → your active Pi model runs as a context firewall: fixed sections, every claim cites `[S#]`, retrieved text treated as untrusted data. Output is validated; bad runs fall back to raw.

You pay one small model call to avoid pasting 50k tokens of HTML into the main context. Override the distiller with `PI_WEB_MINIMAL_DISTILL_MODEL=provider/model-id`. Set `PI_OFFLINE=1` to skip distillation entirely.

## Install

```bash
pi install npm:pi-web-minimal
export EXA_API_KEY=exa-...
export CONTEXT7_API_KEY=ctx7sk-...
```

Or `~/.pi/web-search.json`:

```json
{ "exaApiKey": "...", "context7ApiKey": "...", "distillModel": "provider/model-id" }
```

## Tools

| Tool | For |
| --- | --- |
| `web_search` | discover current sources |
| `code_search` | API/code examples |
| `documentation_search` | live library docs (Context7) |
| `fetch_content` | URLs + GitHub repos (shallow-cloned to `/tmp/pi-github-repos`) |
| `get_search_content` | raw escape hatch by `responseId` when distillation dropped something you needed |

## Dev

```bash
bun test && bun run typecheck && bun run check
```

See `AGENTS.md` for the validation gauntlet, `docs/agent-tool-audit.md` for design notes.
