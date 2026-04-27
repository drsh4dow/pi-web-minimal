# pi-web-minimal

Web, code, docs, and URL fetch tools for Pi with a context firewall.

The goal: give the agent useful evidence, not a landfill. Tools retrieve sources, store raw evidence out of context, then return a compact source-cited brief. Tiny results are compacted without a model call; larger results are distilled with Pi's model. Raw content stays available by `responseId`.

No browser session. No curator UI. No video/PDF pipeline. No broad provider stack.

## Install

```bash
pi install npm:pi-web-minimal
```

## Configure

```bash
export EXA_API_KEY=exa-...
export CONTEXT7_API_KEY=ctx7sk-...
# optional: use a different Pi-registered model for distillation
export PI_WEB_MINIMAL_DISTILL_MODEL=provider/model-id
```

Or `~/.pi/web-search.json`:

```json
{
	"exaApiKey": "exa-...",
	"context7ApiKey": "ctx7sk-...",
	"distillModel": "provider/model-id"
}
```

Exa powers web/code/content fallback. Context7 powers docs. Distillation uses the active Pi model unless overridden.

## Tools

| Tool | Use it for | Default output |
| --- | --- | --- |
| `web_search` | current web/source discovery | compact/distilled source-cited brief |
| `fetch_content` | URLs and GitHub repos | compact/distilled source-cited brief |
| `code_search` | API docs, examples, debugging evidence | compact/distilled source-cited brief |
| `documentation_search` | current library docs via Context7 | compact/distilled source-cited brief |
| `get_search_content` | raw stored evidence by `responseId` | bounded raw content |

GitHub repos are shallow-cloned to `/tmp/pi-github-repos` for direct filesystem inspection.

## Design contract

- Tool output must earn its place in the agent context.
- Raw evidence is stored, not dumped.
- Claims in compact/distilled output cite `[S#]` sources.
- Retrieved content is untrusted; source instructions are not followed.
- `get_search_content` is the raw audit/escape hatch.
- Quality is measured by agent evals: task success, context reduction, citation validity, no fallbacks, injection resistance, and avoiding redundant follow-up calls.

See `docs/agent-tool-audit.md` for details.

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
