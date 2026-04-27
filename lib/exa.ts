import Exa from "exa-js";
import { requireExaApiKey } from "./config.ts";

export interface SearchOptions {
	numResults?: number;
	domainFilter?: string[];
	recencyFilter?: "day" | "week" | "month" | "year";
	signal?: AbortSignal;
}

export interface ExaResult {
	title?: string;
	url?: string;
	publishedDate?: string;
	author?: string;
	text?: string;
	highlights?: string[];
}

export interface ExaSearchData {
	results: ExaResult[];
}

function exaClient(): Exa {
	return new Exa(requireExaApiKey());
}

export function splitDomainFilter(domainFilter: string[] | undefined): {
	includeDomains?: string[];
	excludeDomains?: string[];
} {
	if (!domainFilter?.length) return {};
	const includeDomains = domainFilter
		.filter((domain) => !domain.startsWith("-"))
		.map((domain) => domain.trim())
		.filter(Boolean);
	const excludeDomains = domainFilter
		.filter((domain) => domain.startsWith("-"))
		.map((domain) => domain.slice(1).trim())
		.filter(Boolean);
	return {
		...(includeDomains.length > 0 ? { includeDomains } : {}),
		...(excludeDomains.length > 0 ? { excludeDomains } : {}),
	};
}

export function recencyStartDate(
	filter: SearchOptions["recencyFilter"],
): string | undefined {
	if (!filter) return undefined;
	const days = { day: 1, week: 7, month: 30, year: 365 }[filter];
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

function clampResults(
	value: number | undefined,
	fallback: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(1, Math.min(max, Math.floor(value)));
}

export async function searchWeb(
	query: string,
	options: SearchOptions = {},
): Promise<ExaSearchData> {
	const result = await exaClient().search(query, {
		type: "auto",
		numResults: clampResults(options.numResults, 5, 20),
		...splitDomainFilter(options.domainFilter),
		...(recencyStartDate(options.recencyFilter)
			? { startPublishedDate: recencyStartDate(options.recencyFilter) }
			: {}),
		contents: {
			highlights: { query, maxCharacters: 2_000 },
		},
	} as Parameters<Exa["search"]>[1]);
	return { results: (result.results ?? []) as ExaResult[] };
}

export async function searchCode(
	query: string,
	maxTokens: number | undefined,
): Promise<ExaSearchData> {
	const result = await exaClient().search(query, {
		type: "fast",
		numResults: 8,
		contents: {
			highlights: { query, maxCharacters: Math.min(maxTokens ?? 8_000, 8_000) },
			text: { maxCharacters: 300 },
		},
	} as Parameters<Exa["search"]>[1]);
	return { results: (result.results ?? []) as ExaResult[] };
}

export async function fetchWithExa(
	url: string,
	maxCharacters: number,
): Promise<{ title: string; content: string } | null> {
	const result = await exaClient().getContents([url], {
		text: { maxCharacters },
		livecrawl: "fallback",
		filterEmptyResults: true,
	} as Parameters<Exa["getContents"]>[1]);
	const first = result.results?.[0] as ExaResult | undefined;
	if (!first?.text) return null;
	return {
		title: first.title ?? url,
		content: first.text,
	};
}

export function formatExaResults(results: ExaResult[]): string {
	if (results.length === 0) return "No results found.";
	return results
		.map((result, index) => {
			const lines = [
				`## ${index + 1}. ${result.title || "Untitled"}`,
				`URL: ${result.url || ""}`,
			];
			if (result.publishedDate)
				lines.push(`Published: ${result.publishedDate}`);
			if (result.author) lines.push(`Author: ${result.author}`);
			if (Array.isArray(result.highlights) && result.highlights.length > 0) {
				lines.push("", result.highlights.join("\n"));
			} else if (result.text) {
				lines.push("", result.text);
			}
			return lines.join("\n").trim();
		})
		.join("\n\n---\n\n");
}
