# pi-web-minimal

A tiny Pi package for web research without context bloat.

It exposes only retrieval tools: `web_search`, `fetch_content`, `code_search`, `documentation_search`, and `get_search_content`. Keep it boring. Do not add UI workflows, browser automation, video analysis, broad provider fallbacks, or model-in-tool synthesis.

## Bun-first workflow

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of Jest/Vitest.
- Use `bun run <script>` instead of npm/yarn/pnpm script runners.
- Use `bunx <package> <command>` instead of `npx`.
- Bun automatically loads `.env`; do not add dotenv.

## Validation

Run before claiming ready:

```bash
bun test
bun run typecheck
bun run check
bun pm pack --dry-run
PI_OFFLINE=1 bunx --bun pi --no-extensions -e . --list-models >/tmp/pi-web-minimal-pi-load.out
```

Live integration checks require keys:

```bash
RUN_LIVE_TESTS=1 bun test live.test.ts
```
