# Agent-tool audit

pi-web-minimal is intentionally a retrieval package, not a browser, curator, or synthesis layer. This audit records the design standard used for changes and future reviews.

## Standard

- Keep the tool surface small and intent-specific.
- Return bounded, high-signal previews by default.
- Store larger content outside the assistant message and require explicit retrieval by `responseId`.
- Make tool names, descriptions, and parameter descriptions enough for agent autodiscovery without long prompt guidelines.
- Keep provider policy narrow: Exa for web/code/content fallback, Context7 for library docs. Add another provider only if real Pi evals show a persistent gap.
- Validate package discovery through Pi itself, not only unit tests.

## Current verdict

The package follows the core pattern: five retrieval tools, no UI workflow, no model-in-tool synthesis, and no broad provider fallback stack. The main context-risk was `get_search_content`: it returned stored content unbounded, so an agent could accidentally rehydrate a large fetch or documentation result into the conversation. It now returns a bounded slice by default and requires `maxCharacters` to opt into more context.

## Tool surface

| Tool | Intent | Context behavior |
| --- | --- | --- |
| `web_search` | Current/web source discovery | Bounded snippets; stores full formatted result by query index. |
| `code_search` | Code/API examples and references | Bounded evidence; stores result by query index. |
| `documentation_search` | Current library/framework docs via Context7 | Bounded preview; stores documentation context by query index. |
| `fetch_content` | Specific URL/GitHub retrieval | Bounded inline content for one URL, summaries for many URLs; stores per-URL content. |
| `get_search_content` | Explicit stored-content retrieval | Bounded by default; caller chooses selector and `maxCharacters`. |

Keeping these as separate tools is deliberate: the names map to distinct agent intents and avoid a large router schema.

## Context-pollution notes

- `appendEntry()` custom entries are not sent to the LLM, so stored results avoid immediate context pollution.
- Session files can still grow because stored content is persisted for branch/reload recovery. This is acceptable for now because retrieval continuity is more valuable than an external cache, but it should be watched in eval reports.
- Tool output must remain bounded. Future additions should add selectors, filtering, pagination, or explicit retrieval rather than larger default outputs.

## Autodiscovery notes

- Tool descriptions name the backing provider and whether output is bounded.
- Prompt snippets are short and action-oriented.
- No `promptGuidelines` are used today; adding flat global guidelines would increase baseline prompt size and should require eval evidence.
- Package metadata uses the Pi package manifest and `pi-package` keyword for gallery/package discovery.

## Eval gate

Use the live real-Pi agent eval when changing tool names, descriptions, schemas, result shapes, or provider behavior:

```bash
RUN_AGENT_EVAL=1 PI_EVAL_MODEL=<provider/model> bun test agent-eval.test.ts
```

The eval is black-box: it invokes Pi with this package as an extension and checks task success plus response-size budget. It complements, but does not replace, unit tests and live provider smoke tests.
