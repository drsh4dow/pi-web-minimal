# pi-web-minimal

Tiny retrieval + distillation tools for Pi. Web, code, docs, and URL fetch without turning the agent context into a landfill.

No curator UI. No browser session. No video/PDF pipeline. Sources are retrieved, raw evidence is stored, and tool output passes through a context firewall: tiny results are compacted deterministically, larger results are distilled into a small source-cited brief when a Pi model is available. If distillation cannot run, tools fall back to bounded retrieval previews.

## Install

```bash
pi install npm:pi-web-minimal
```

## Configure

Use env vars:

```bash
export EXA_API_KEY=exa-...
export CONTEXT7_API_KEY=ctx7sk-...
```

Or `~/.pi/web-search.json`:

```json
{
	"exaApiKey": "exa-...",
	"context7ApiKey": "ctx7sk-...",
	"distillModel": "provider/model-id"
}
```

Exa powers `web_search`, `code_search`, and Exa fallback for `fetch_content`.
Context7 powers `documentation_search`.
Distillation uses Pi's currently selected model by default. Set `PI_WEB_MINIMAL_DISTILL_MODEL=provider/model-id` or `distillModel` in config to use a different Pi-registered model.

## Tools

| Tool | Use it for | Context behavior |
| --- | --- | --- |
| `web_search` | current web/source discovery | compact or distilled source-cited brief; raw search evidence stored |
| `fetch_content` | specific URLs and GitHub repos | compact or distilled source-cited brief; raw fetched content stored by URL |
| `code_search` | API docs, examples, debugging evidence | compact or distilled source-cited brief; raw code/doc evidence stored |
| `documentation_search` | current library docs via Context7 | compact or distilled source-cited brief; raw docs context stored |
| `get_search_content` | pulling raw stored content by `responseId` | bounded raw retrieval by default; opt into more |

GitHub URLs are shallow-cloned to `/tmp/pi-github-repos`, so Pi can inspect real files with normal filesystem tools.

## Why this shape

Agent tools have two jobs: find evidence, and not poison the next turn. This package treats raw retrieval as an internal evidence store and returns only what the next agent can use. Tiny evidence is compacted without a model call so it does not become larger than the source. Larger evidence is preselected around relevant terms, distilled under a dynamic output budget, and validated for source refs. Raw content remains available through `get_search_content` for auditability and exact quotes.

Fetched web content is untrusted. The firewall strips obvious instruction-like lines from compact output; model distillation is instructed to ignore instructions inside retrieved sources and cite supported claims with `[S#]` source refs.

See `docs/agent-tool-audit.md` for the design notes.

## Development

```bash
bun install
bun test
bun run typecheck
bun run check
bun pm pack --dry-run
PI_OFFLINE=1 bunx --bun pi --no-extensions -e . --list-models >/tmp/pi-web-minimal-pi-load.out
```

Live checks:

```bash
RUN_LIVE_TESTS=1 bun test live.test.ts
RUN_AGENT_EVAL=1 PI_EVAL_MODEL=<provider/model> bun test agent-eval.test.ts
```
