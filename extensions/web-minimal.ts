import { StringEnum, Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { searchDocumentation } from "../lib/context7.ts";
import { distillRetrieval } from "../lib/distill.ts";
import { formatExaResults, searchCode, searchWeb } from "../lib/exa.ts";
import { fetchMany } from "../lib/fetch.ts";
import {
	CONTENT_RETRIEVAL_CHARS,
	FETCH_INLINE_CHARS,
	formatChars,
	SEARCH_PREVIEW_CHARS,
	truncateText,
} from "../lib/format.ts";
import { clearCloneCache } from "../lib/github.ts";
import {
	clearResults,
	findStoredItem,
	generateId,
	getResult,
	restoreFromSession,
	type StoredItem,
	type StoredWebData,
	storeResult,
} from "../lib/storage.ts";

function textResult(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function normalizeQueries(params: {
	query?: unknown;
	queries?: unknown;
}): string[] {
	const raw = Array.isArray(params.queries)
		? params.queries
		: params.query !== undefined
			? [params.query]
			: [];
	return raw
		.filter((query): query is string => typeof query === "string")
		.map((query) => query.trim())
		.filter(Boolean);
}

function normalizeUrls(params: { url?: unknown; urls?: unknown }): string[] {
	const raw = Array.isArray(params.urls)
		? params.urls
		: params.url !== undefined
			? [params.url]
			: [];
	return raw
		.filter((url): url is string => typeof url === "string")
		.map((url) => url.trim())
		.filter(Boolean);
}

function normalizeDomainFilter(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const domains = value
		.filter((domain): domain is string => typeof domain === "string")
		.map((domain) => domain.trim())
		.filter(Boolean);
	return domains.length > 0 ? domains : undefined;
}

function normalizeNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeRecency(
	value: unknown,
): "day" | "week" | "month" | "year" | undefined {
	return value === "day" ||
		value === "week" ||
		value === "month" ||
		value === "year"
		? value
		: undefined;
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function store(pi: ExtensionAPI, data: StoredWebData): void {
	storeResult(data);
	pi.appendEntry("web-minimal-results", data);
}

function responseNotice(responseId: string, selector: string): string {
	return `\n\n---\nresponseId: ${responseId}\nUse get_search_content({ responseId: "${responseId}", ${selector} }) for raw stored content. It returns up to ${formatChars(CONTENT_RETRIEVAL_CHARS)} by default; pass maxCharacters when you need a different bound.`;
}

function fallbackNotice(reason: string | undefined): string {
	return `[Distillation skipped: ${reason ?? "unavailable"}]\n\n`;
}

function renderSimpleCall(
	name: string,
	value: unknown,
	theme: Parameters<
		NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderCall"]>
	>[1],
) {
	const raw = typeof value === "string" ? value : "";
	const display = raw.length > 70 ? `${raw.slice(0, 67)}...` : raw || "(empty)";
	return new Text(
		theme.fg("toolTitle", theme.bold(`${name} `)) + theme.fg("accent", display),
		0,
		0,
	);
}

export default function webMinimalExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => restoreFromSession(ctx));
	pi.on("session_tree", async (_event, ctx) => restoreFromSession(ctx));
	pi.on("session_shutdown", () => {
		clearResults();
		clearCloneCache();
	});

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web with Exa. Returns model-distilled, source-cited findings plus raw stored evidence. For research, prefer queries with 2-4 varied angles.",
		promptSnippet:
			"Use for current/web research. Prefer queries:[...] with varied phrasings; fetch promising URLs separately for full content.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query" })),
			queries: Type.Optional(
				Type.Array(Type.String(), {
					description: "Multiple varied search queries",
				}),
			),
			numResults: Type.Optional(
				Type.Number({
					minimum: 1,
					maximum: 20,
					description: "Results per query (default 5, max 20)",
				}),
			),
			domainFilter: Type.Optional(
				Type.Array(Type.String(), {
					description: "Domains to include, or prefix with - to exclude",
				}),
			),
			recencyFilter: Type.Optional(
				StringEnum(["day", "week", "month", "year"], {
					description: "Filter by publish recency",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const queries = normalizeQueries(params);
			if (queries.length === 0) {
				return textResult("Error: No query provided.", {
					error: "No query provided",
				});
			}

			const items: StoredItem[] = [];
			const sections: string[] = [];
			for (let index = 0; index < queries.length; index++) {
				if (signal?.aborted) throw new Error("Aborted");
				onUpdate?.({
					content: [
						{
							type: "text",
							text: `Searching ${index + 1}/${queries.length}: ${queries[index]}`,
						},
					],
					details: { phase: "search", progress: index / queries.length },
				});
				try {
					const data = await searchWeb(queries[index] as string, {
						numResults: normalizeNumber(params.numResults, 5, 1, 20),
						domainFilter: normalizeDomainFilter(params.domainFilter),
						recencyFilter: normalizeRecency(params.recencyFilter),
						signal,
					});
					const content = formatExaResults(data.results);
					items.push({
						key: String(index),
						title: queries[index] as string,
						query: queries[index] as string,
						content,
					});
					sections.push(`## Query ${index}: ${queries[index]}\n\n${content}`);
				} catch (error) {
					const message = errorText(error);
					items.push({
						key: String(index),
						title: queries[index] as string,
						query: queries[index] as string,
						content: "",
						error: message,
					});
					sections.push(
						`## Query ${index}: ${queries[index]}\n\nError: ${message}`,
					);
				}
			}

			const responseId = generateId();
			onUpdate?.({
				content: [{ type: "text", text: "Distilling search evidence..." }],
				details: { phase: "distill", progress: 0.95 },
			});
			const distilled = await distillRetrieval({
				ctx,
				toolName: "web_search",
				task: queries.join(" | "),
				sources: items.map((item) => ({
					title: item.title,
					query: item.query,
					content: item.content,
					error: item.error,
				})),
				signal,
			});
			store(pi, {
				id: responseId,
				type: "search",
				timestamp: Date.now(),
				items,
				...(distilled.text ? { synthesis: distilled.text } : {}),
			});
			const output = truncateText(sections.join("\n\n"), SEARCH_PREVIEW_CHARS);
			const text = distilled.text
				? distilled.text
				: `${fallbackNotice(distilled.details.fallbackReason)}${output.text}`;
			return textResult(
				`${text}${responseNotice(responseId, "queryIndex: 0")}`,
				{
					responseId,
					queryCount: queries.length,
					rawTruncated: output.truncated,
					rawChars: output.fullChars,
					distillation: distilled.details,
				},
			);
		},
		renderCall(args, theme) {
			const params = args as { query?: string; queries?: string[] };
			return renderSimpleCall(
				"web_search",
				params.query ?? params.queries?.join(" | "),
				theme,
			);
		},
	});

	pi.registerTool({
		name: "code_search",
		label: "Code Search",
		description:
			"Search for code examples, API references, and programming documentation with Exa. Returns model-distilled, source-cited findings plus raw stored evidence.",
		promptSnippet:
			"Use before coding against unfamiliar APIs or debugging library behavior; ask specific library/API questions.",
		parameters: Type.Object({
			query: Type.String({
				description: "Programming question, API, library, or debugging topic",
			}),
			maxTokens: Type.Optional(
				Type.Number({
					minimum: 1000,
					maximum: 50000,
					description: "Maximum retrieval budget hint",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const query = typeof params.query === "string" ? params.query.trim() : "";
			if (!query)
				return textResult("Error: No query provided.", {
					error: "No query provided",
				});
			try {
				const data = await searchCode(
					query,
					normalizeNumber(params.maxTokens, SEARCH_PREVIEW_CHARS, 1000, 50000),
				);
				const content = formatExaResults(data.results);
				const responseId = generateId();
				onUpdate?.({
					content: [{ type: "text", text: "Distilling code evidence..." }],
					details: { phase: "distill", progress: 0.95 },
				});
				const distilled = await distillRetrieval({
					ctx,
					toolName: "code_search",
					task: query,
					sources: [{ title: query, query, content }],
					signal,
				});
				store(pi, {
					id: responseId,
					type: "code",
					timestamp: Date.now(),
					items: [{ key: "0", title: query, query, content }],
					...(distilled.text ? { synthesis: distilled.text } : {}),
				});
				const output = truncateText(content, SEARCH_PREVIEW_CHARS);
				const text = distilled.text
					? distilled.text
					: `${fallbackNotice(distilled.details.fallbackReason)}${output.text}`;
				return textResult(
					`${text}${responseNotice(responseId, "queryIndex: 0")}`,
					{
						responseId,
						query,
						rawTruncated: output.truncated,
						rawChars: output.fullChars,
						distillation: distilled.details,
					},
				);
			} catch (error) {
				return textResult(`Error: ${errorText(error)}`, {
					error: errorText(error),
					query,
				});
			}
		},
		renderCall(args, theme) {
			return renderSimpleCall(
				"code_search",
				(args as { query?: string }).query,
				theme,
			);
		},
	});

	pi.registerTool({
		name: "documentation_search",
		label: "Documentation Search",
		description:
			"Search current library/framework documentation through Context7. Returns model-distilled, source-cited findings plus raw stored evidence.",
		promptSnippet:
			"Use for current library/framework documentation. Pass library + a specific query; use libraryId when already known.",
		parameters: Type.Object({
			library: Type.Optional(
				Type.String({ description: "Library name, e.g. react or nextjs" }),
			),
			libraryId: Type.Optional(
				Type.String({
					description: "Known Context7 library ID, e.g. /vercel/next.js",
				}),
			),
			query: Type.String({
				description: "Specific documentation question/topic",
			}),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const query = typeof params.query === "string" ? params.query.trim() : "";
			const library =
				typeof params.library === "string" ? params.library.trim() : undefined;
			const libraryId =
				typeof params.libraryId === "string"
					? params.libraryId.trim()
					: undefined;
			if (!query)
				return textResult("Error: No query provided.", {
					error: "No query provided",
				});
			try {
				const docs = await searchDocumentation({ library, libraryId, query });
				const responseId = generateId();
				onUpdate?.({
					content: [
						{ type: "text", text: "Distilling documentation evidence..." },
					],
					details: { phase: "distill", progress: 0.95 },
				});
				const distilled = await distillRetrieval({
					ctx,
					toolName: "documentation_search",
					task: `${docs.libraryTitle}: ${query}`,
					sources: [
						{
							title: docs.libraryTitle,
							query,
							content: docs.content,
						},
					],
					signal,
				});
				store(pi, {
					id: responseId,
					type: "documentation",
					timestamp: Date.now(),
					items: [
						{
							key: "0",
							title: docs.libraryTitle,
							query,
							content: docs.content,
						},
					],
					...(distilled.text ? { synthesis: distilled.text } : {}),
				});
				const output = truncateText(docs.content, SEARCH_PREVIEW_CHARS);
				const header = `Library: ${docs.libraryTitle}\nLibrary ID: ${docs.libraryId}\n\n`;
				const text = distilled.text
					? `${header}${distilled.text}`
					: `${header}${fallbackNotice(distilled.details.fallbackReason)}${output.text}`;
				return textResult(
					`${text}${responseNotice(responseId, "queryIndex: 0")}`,
					{
						responseId,
						libraryId: docs.libraryId,
						libraryTitle: docs.libraryTitle,
						rawTruncated: output.truncated,
						rawChars: output.fullChars,
						distillation: distilled.details,
					},
				);
			} catch (error) {
				return textResult(`Error: ${errorText(error)}`, {
					error: errorText(error),
					query,
					library,
					libraryId,
				});
			}
		},
		renderCall(args, theme) {
			const params = args as {
				library?: string;
				libraryId?: string;
				query?: string;
			};
			return renderSimpleCall(
				"documentation_search",
				`${params.libraryId ?? params.library ?? ""}: ${params.query ?? ""}`,
				theme,
			);
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch Content",
		description:
			"Fetch URL content as markdown/text and return model-distilled, source-cited findings plus raw stored content for follow-up retrieval. GitHub repos are shallow-cloned locally. Pages use HTTP readability extraction first, then Exa contents fallback.",
		promptSnippet:
			"Use to fetch specific URLs. For GitHub repos, inspect the returned local path with read/bash if more detail is needed.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(
				Type.Array(Type.String(), { description: "Multiple URLs to fetch" }),
			),
			maxCharacters: Type.Optional(
				Type.Number({
					minimum: 1000,
					maximum: 200000,
					description: "Maximum stored characters per URL (default 100000)",
				}),
			),
			forceClone: Type.Optional(
				Type.Boolean({
					description: "Re-clone GitHub repositories even if cached",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const urls = normalizeUrls(params);
			if (urls.length === 0)
				return textResult("Error: No URL provided.", {
					error: "No URL provided",
				});
			onUpdate?.({
				content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }],
				details: { phase: "fetch", progress: 0 },
			});
			const maxCharacters = normalizeNumber(
				params.maxCharacters,
				100_000,
				1000,
				200000,
			);
			const results = await fetchMany(
				urls,
				{ maxCharacters, forceClone: params.forceClone === true },
				signal,
			);
			const responseId = generateId();
			const items: StoredItem[] = results.map((result, index) => ({
				key: String(index),
				title: result.title || result.url,
				url: result.url,
				content: result.content,
				error: result.error,
			}));
			onUpdate?.({
				content: [{ type: "text", text: "Distilling fetched content..." }],
				details: { phase: "distill", progress: 0.95 },
			});
			const distilled = await distillRetrieval({
				ctx,
				toolName: "fetch_content",
				task: urls.join(" | "),
				sources: items.map((item) => ({
					title: item.title,
					url: item.url,
					content: item.content,
					error: item.error,
				})),
				signal,
			});
			store(pi, {
				id: responseId,
				type: "fetch",
				timestamp: Date.now(),
				items,
				...(distilled.text ? { synthesis: distilled.text } : {}),
			});

			if (results.length === 1) {
				const result = results[0];
				if (!result || result.error) {
					return textResult(
						`Error: ${result?.error ?? "Unknown fetch error"}`,
						{
							responseId,
							error: result?.error,
							urlCount: 1,
							distillation: distilled.details,
						},
					);
				}
				const output = truncateText(result.content, FETCH_INLINE_CHARS);
				const text = distilled.text
					? distilled.text
					: `${fallbackNotice(distilled.details.fallbackReason)}${output.text}`;
				return textResult(
					`${text}${responseNotice(responseId, "urlIndex: 0")}`,
					{
						responseId,
						urlCount: 1,
						title: result.title,
						source: result.source,
						rawTruncated: output.truncated,
						rawChars: output.fullChars,
						distillation: distilled.details,
					},
				);
			}

			const summary = results
				.map((result, index) => {
					if (result.error)
						return `${index}. ${result.url}: Error - ${result.error}`;
					return `${index}. ${result.title || result.url} (${formatChars(result.content.length)}, ${result.source})`;
				})
				.join("\n");
			const text = distilled.text
				? distilled.text
				: `${fallbackNotice(distilled.details.fallbackReason)}${summary}`;
			return textResult(`${text}${responseNotice(responseId, "urlIndex: 0")}`, {
				responseId,
				urlCount: results.length,
				successful: results.filter((result) => !result.error).length,
				distillation: distilled.details,
			});
		},
		renderCall(args, theme) {
			const params = args as { url?: string; urls?: string[] };
			return renderSimpleCall(
				"fetch_content",
				params.url ?? params.urls?.join(" | "),
				theme,
			);
		},
	});

	pi.registerTool({
		name: "get_search_content",
		label: "Get Search Content",
		description:
			"Retrieve bounded raw stored content from previous pi-web-minimal tool calls by responseId and selector. Use maxCharacters to control how much content enters context.",
		promptSnippet:
			"Use after web_search, fetch_content, code_search, or documentation_search when more stored content is needed; set maxCharacters deliberately.",
		parameters: Type.Object({
			responseId: Type.String({ description: "Stored response id" }),
			query: Type.Optional(
				Type.String({ description: "Get content for exact query" }),
			),
			queryIndex: Type.Optional(
				Type.Number({ description: "Get content by query/result index" }),
			),
			url: Type.Optional(
				Type.String({ description: "Get content for exact URL" }),
			),
			urlIndex: Type.Optional(
				Type.Number({ description: "Get content by URL index" }),
			),
			maxCharacters: Type.Optional(
				Type.Number({
					minimum: 1000,
					maximum: 200000,
					description:
						"Maximum characters to return (default 50000, max 200000)",
				}),
			),
		}),
		async execute(_toolCallId, params) {
			const data = getResult(params.responseId);
			if (!data)
				return textResult(
					`Error: No stored content for "${params.responseId}".`,
					{ error: "Not found" },
				);
			const item = findStoredItem(data, {
				query: params.query,
				queryIndex:
					typeof params.queryIndex === "number"
						? Math.floor(params.queryIndex)
						: undefined,
				url: params.url,
				urlIndex:
					typeof params.urlIndex === "number"
						? Math.floor(params.urlIndex)
						: undefined,
			});
			if (typeof item === "string")
				return textResult(item, { error: item, responseId: params.responseId });
			if (item.error)
				return textResult(`Error: ${item.error}`, {
					error: item.error,
					responseId: params.responseId,
				});
			const maxCharacters = normalizeNumber(
				params.maxCharacters,
				CONTENT_RETRIEVAL_CHARS,
				1000,
				200000,
			);
			const output = truncateText(item.content, maxCharacters);
			return textResult(output.text, {
				responseId: params.responseId,
				title: item.title,
				url: item.url,
				query: item.query,
				chars: item.content.length,
				returnedChars: Math.min(item.content.length, maxCharacters),
				truncated: output.truncated,
			});
		},
		renderCall(args, theme) {
			return renderSimpleCall(
				"get_search_content",
				(args as { responseId?: string }).responseId,
				theme,
			);
		},
	});
}
