import { getFirecrawlApiKey } from "./config.ts";

const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const MAX_FIRECRAWL_RESPONSE_BYTES = 5 * 1024 * 1024;

interface FirecrawlScrapeResponse {
	success?: boolean;
	data?: {
		markdown?: unknown;
		metadata?: {
			title?: unknown;
			sourceURL?: unknown;
			url?: unknown;
			error?: unknown;
		};
		warning?: unknown;
	};
	error?: unknown;
	warning?: unknown;
}

export interface FirecrawlContent {
	title: string;
	content: string;
}

function capContent(text: string, maxCharacters: number): string {
	return text.length > maxCharacters
		? `${text.slice(0, maxCharacters)}\n\n[Content capped at ${maxCharacters} characters]`
		: text;
}

function cleanString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	return text.length > 0 ? text : null;
}

async function firecrawlError(response: Response): Promise<string> {
	let body = "";
	try {
		body = await response.text();
	} catch {}
	return `Firecrawl API error ${response.status}: ${body.slice(0, 300)}`;
}

function parseFirecrawlContent(
	url: string,
	data: FirecrawlScrapeResponse,
	maxCharacters: number,
): FirecrawlContent | null {
	if (data.success === false) {
		const error =
			cleanString(data.error) ??
			cleanString(data.data?.metadata?.error) ??
			cleanString(data.warning) ??
			"unknown error";
		throw new Error(`Firecrawl scrape failed: ${error}`);
	}

	const markdown = cleanString(data.data?.markdown);
	if (!markdown) return null;
	return {
		title:
			cleanString(data.data?.metadata?.title) ??
			cleanString(data.data?.metadata?.sourceURL) ??
			cleanString(data.data?.metadata?.url) ??
			url,
		content: capContent(markdown, maxCharacters),
	};
}

export async function fetchWithFirecrawl(
	url: string,
	maxCharacters: number,
	signal?: AbortSignal,
): Promise<FirecrawlContent | null> {
	const apiKey = getFirecrawlApiKey();
	if (!apiKey) return null;

	const response = await fetch(FIRECRAWL_SCRAPE_URL, {
		method: "POST",
		signal: AbortSignal.any([
			AbortSignal.timeout(60_000),
			...(signal ? [signal] : []),
		]),
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			url,
			formats: ["markdown"],
			onlyMainContent: true,
		}),
	});

	if (!response.ok) throw new Error(await firecrawlError(response));
	const length = Number(response.headers.get("content-length") ?? 0);
	if (length > MAX_FIRECRAWL_RESPONSE_BYTES) {
		throw new Error(
			`Firecrawl response too large: ${Math.round(length / 1024 / 1024)}MB`,
		);
	}
	const text = await response.text();
	if (text.length > MAX_FIRECRAWL_RESPONSE_BYTES) {
		throw new Error("Firecrawl response too large.");
	}
	return parseFirecrawlContent(
		url,
		JSON.parse(text) as FirecrawlScrapeResponse,
		maxCharacters,
	);
}
