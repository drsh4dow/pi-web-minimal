# pi-web-minimal

Minimal web access for Pi: Exa search/fetch/code retrieval, Context7 documentation lookup, GitHub-aware fetching, and explicit bounded stored-content retrieval.

No curator UI. No browser cookies. No Gemini. No Perplexity. No video. No PDF parser. No hidden synthesis layer. Tool outputs are retrieval-first and bounded by default to limit agent context pollution.

## Install

```bash
pi install npm:pi-web-minimal
```

## Config

Exa is required for `web_search`, `fetch_content` fallback, and `code_search`:

```json
{
	"exaApiKey": "exa-..."
}
```

Context7 is required for `documentation_search`:

```json
{
	"context7ApiKey": "ctx7sk-..."
}
```

The config file is `~/.pi/web-search.json`. Environment variables also work:

- `EXA_API_KEY`
- `CONTEXT7_API_KEY`

## Tools

### web_search

Retrieval-first Exa search. Returns bounded snippets and source URLs. Use `queries` with varied phrasings for broader research.

### fetch_content

Fetch URL content. GitHub URLs are shallow-cloned to `/tmp/pi-github-repos` so the agent can inspect real files. Normal pages use deterministic HTTP/readability extraction first, then Exa contents as fallback.

### code_search

Exa search tuned for code examples, API docs, and debugging context.

### documentation_search

Context7 documentation lookup. Provide `library` + `query`, or `libraryId` + `query` when the exact Context7 ID is known.

### get_search_content

Retrieves stored content from previous tool calls by `responseId`. Output is bounded by default; pass `maxCharacters` deliberately when more content is needed.

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

See `docs/agent-tool-audit.md` for the anti-context-pollution and autodiscovery review rubric.
