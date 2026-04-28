# pi-web-minimal

Web research for Pi agents without trashing the context window.

LLMs research badly: a single `fetch` or search dump can blow 50k tokens of HTML, ads, and nav chrome into context, evicting the actual work. This package wraps Exa + Context7 behind tools that **store raw results out-of-band and return a short, source-cited brief**. The agent gets evidence; you keep your context budget.

Suckless by design. No browser session, no curator UI, no PDF/video pipeline, no provider zoo.

## How

Two-stage pipeline per call:

1. **Retrieve** via Exa / Context7 / git clone. Raw evidence is stored out-of-band under a `responseId`; session persistence is bounded so long runs do not bloat context/history.
2. **Distill/extract** before returning:
   - Small payloads → deterministic extractive compaction (no model call).
   - Larger payloads → your active Pi model runs as a context firewall over ranked snippets: fixed sections, every finding cites `[S#]`, retrieved text treated as untrusted data. Output is validated.
   - If model distillation is unavailable, the fallback is a bounded extractive report, not a first-N raw dump.

You pay one small model call to avoid pasting 50k tokens of HTML into the main context. Override the distiller with `PI_WEB_MINIMAL_DISTILL_MODEL=provider/model-id`. Set `PI_OFFLINE=1` to skip model distillation and use deterministic extraction.

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
| `get_search_content` | raw escape hatch by `responseId` with `sourceIndex`/`urlIndex`, `offset`, `section`, or `textSearch` selectors when distillation dropped something you needed |

## Dev

```bash
bun test && bun run typecheck && bun run check
```

See `AGENTS.md` for the validation gauntlet, `docs/agent-tool-audit.md` for design notes.
