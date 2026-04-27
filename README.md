# pi-web-minimal

Tiny retrieval tools for Pi. Web, code, docs, and URL fetch without turning the agent context into a landfill.

No curator UI. No browser session. No video/PDF pipeline. No model-in-tool synthesis. Just sources in, bounded text out, full-ish content behind an explicit `responseId` pull.

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
	"context7ApiKey": "ctx7sk-..."
}
```

Exa powers `web_search`, `code_search`, and Exa fallback for `fetch_content`.
Context7 powers `documentation_search`.

## Tools

| Tool | Use it for | Context behavior |
| --- | --- | --- |
| `web_search` | current web/source discovery | bounded snippets + URLs |
| `fetch_content` | specific URLs and GitHub repos | bounded inline text; stores by URL |
| `code_search` | API docs, examples, debugging evidence | bounded code/doc evidence |
| `documentation_search` | current library docs via Context7 | bounded docs context |
| `get_search_content` | pulling stored content by `responseId` | bounded by default; opt into more |

GitHub URLs are shallow-cloned to `/tmp/pi-github-repos`, so Pi can inspect real files with normal filesystem tools.

## Why this shape

Agent tools have two jobs: find evidence, and not poison the next turn. This package keeps large retrievals out of the assistant message until the agent explicitly asks for them.

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
