# Agent-tool audit

pi-web-minimal is intentionally a retrieval + distillation package, not a browser or curator UI. This audit records the design standard used for changes and future reviews.

## Standard

- Keep the tool surface small and intent-specific.
- Return compact or model-distilled source-cited briefs by default.
- Store larger raw content outside the assistant message and require explicit retrieval by `responseId`.
- Keep `get_search_content` deterministic and raw as the audit/escape hatch.
- Make tool names, descriptions, and parameter descriptions enough for agent autodiscovery without long prompt guidelines.
- Keep provider policy narrow: Exa for web/code/content fallback, Context7 for library docs, and Pi's configured model for distillation. Add another provider only if real Pi evals show a persistent gap.
- Validate package discovery through Pi itself, not only unit tests.

## Current verdict

The package follows the new core pattern: five retrieval tools, no UI workflow, adaptive context-firewall output, raw evidence stored out of context, and no broad provider fallback stack. Tiny evidence is compacted deterministically; larger evidence is model-distilled with source refs. The main context-risk remains `get_search_content`: it can rehydrate large stored content into the conversation. It returns a bounded slice by default and requires `maxCharacters` to opt into more context.

## Tool surface

| Tool | Intent | Context behavior |
| --- | --- | --- |
| `web_search` | Current/web source discovery | Compact or distilled source-cited brief; stores raw formatted result by query index. |
| `code_search` | Code/API examples and references | Compact or distilled source-cited brief; stores raw result by query index. |
| `documentation_search` | Current library/framework docs via Context7 | Compact or distilled source-cited brief; stores raw documentation context by query index. |
| `fetch_content` | Specific URL/GitHub retrieval | Compact or distilled source-cited brief for fetched URL batches; stores raw per-URL content. |
| `get_search_content` | Explicit raw stored-content retrieval | Bounded raw content by default; caller chooses selector and `maxCharacters`. |

Keeping these as separate tools is deliberate: the names map to distinct agent intents and avoid a large router schema.

## Context-pollution notes

- `appendEntry()` custom entries are not sent to the LLM, so stored raw results avoid immediate context pollution.
- Session files can still grow because stored content and distilled briefs are persisted for branch/reload recovery. This is acceptable for now because retrieval continuity and auditability are more valuable than an external cache, but it should be watched in eval reports.
- Tool output must remain compact. Future additions should improve evidence selection, citations, selectors, filtering, pagination, or explicit retrieval rather than larger default outputs.
- Tiny raw evidence should not be expanded through a model. Use deterministic compact mode unless the source is large enough to need synthesis.
- Retrieved web/docs/code content is untrusted. Compact mode strips obvious instruction-like lines. Distillation prompts must separate source blocks from instructions and require source refs for substantive claims.

## Autodiscovery notes

- Tool descriptions name the backing provider, distilled output, and raw stored evidence.
- Prompt snippets are short and action-oriented.
- No `promptGuidelines` are used today; adding flat global guidelines would increase baseline prompt size and should require eval evidence.
- Package metadata uses the Pi package manifest and `pi-package` keyword for gallery/package discovery.

## Eval gate

Use the live real-Pi agent eval when changing tool names, descriptions, schemas, result shapes, provider behavior, or distillation behavior:

```bash
RUN_AGENT_EVAL=1 PI_EVAL_MODEL=<provider/model> bun test agent-eval.test.ts
```

The eval is black-box: it invokes Pi with this package as an extension and checks task success plus response-size budget. Context-firewall changes should compare raw retrieved chars against compact/distilled output chars in tool details to prove context reduction without task regression. It complements, but does not replace, unit tests and live provider smoke tests.

Tracked quality KPIs:

- Task success: process exit, required marker, expected answer regex, and required tool use.
- Context firewall effectiveness: raw retrieved chars versus compact/distilled output chars.
- Small-source non-expansion: tiny sources must stay within a tight output multiplier.
- Mode coverage: compact, distilled, and fallback counts; normal live evals require zero fallback.
- Citation precision: compact/distilled tool outputs must validate source references.
- Injection resistance: hostile fixture output must exclude injected instructions and still answer supported facts.
- Answer sufficiency: simple tasks must complete without redundant follow-up tools.
- Latency: per-task elapsed milliseconds are recorded in the report.
