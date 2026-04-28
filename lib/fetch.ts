import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import pLimit from "p-limit";
import TurndownService from "turndown";
import { fetchWithExa } from "./exa.ts";
import { DEFAULT_FETCH_MAX_CHARS, errorMessage } from "./format.ts";
import { extractGitHub } from "./github.ts";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 3;

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});

export interface FetchResult {
	url: string;
	title: string;
	content: string;
	error: string | null;
	source: "github" | "http" | "exa";
}

function titleFromText(text: string, url: string): string {
	const heading = text.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
	if (heading) return heading;
	return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? url;
}

function isLikelyHtml(contentType: string, text: string): boolean {
	return (
		contentType.includes("text/html") ||
		/^\s*<!doctype html|<html[\s>]/i.test(text)
	);
}

function capContent(text: string, maxCharacters: number): string {
	return text.length > maxCharacters
		? `${text.slice(0, maxCharacters)}\n\n[Content capped at ${maxCharacters} characters]`
		: text;
}

async function extractHttp(
	url: string,
	maxCharacters: number,
	signal?: AbortSignal,
): Promise<FetchResult> {
	const response = await fetch(url, {
		signal: AbortSignal.any([
			AbortSignal.timeout(30_000),
			...(signal ? [signal] : []),
		]),
		headers: {
			"User-Agent":
				"Mozilla/5.0 (compatible; pi-web-minimal/0.1; +https://github.com/drsh4dow/pi-web-minimal)",
			Accept:
				"text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
		},
	});
	if (!response.ok) {
		return {
			url,
			title: "",
			content: "",
			error: `HTTP ${response.status}: ${response.statusText}`,
			source: "http",
		};
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (
		/image\/|audio\/|video\/|application\/(zip|octet-stream)/.test(contentType)
	) {
		return {
			url,
			title: "",
			content: "",
			error: `Unsupported content type: ${contentType.split(";")[0]}`,
			source: "http",
		};
	}
	const length = Number(response.headers.get("content-length") ?? 0);
	if (length > MAX_RESPONSE_BYTES) {
		return {
			url,
			title: "",
			content: "",
			error: `Response too large: ${Math.round(length / 1024 / 1024)}MB`,
			source: "http",
		};
	}

	const text = await response.text();
	if (!isLikelyHtml(contentType, text)) {
		return {
			url,
			title: titleFromText(text, url),
			content: capContent(text, maxCharacters),
			error: null,
			source: "http",
		};
	}

	const { document } = parseHTML(text);
	const article = new Readability(document as unknown as Document).parse();
	if (!article?.content) {
		return {
			url,
			title: "",
			content: "",
			error: "Could not extract readable content from HTML.",
			source: "http",
		};
	}
	const markdown = turndown.turndown(article.content).trim();
	if (markdown.length < 100) {
		return {
			url,
			title: article.title ?? "",
			content: markdown,
			error: "Extracted content appears incomplete.",
			source: "http",
		};
	}
	return {
		url,
		title: article.title ?? titleFromText(markdown, url),
		content: capContent(markdown, maxCharacters),
		error: null,
		source: "http",
	};
}

export async function fetchOne(
	url: string,
	options: {
		maxCharacters?: number;
		forceClone?: boolean;
	} = {},
	signal?: AbortSignal,
): Promise<FetchResult> {
	const maxCharacters = options.maxCharacters ?? DEFAULT_FETCH_MAX_CHARS;
	const github = await extractGitHub(url, options.forceClone);
	if (github) {
		return {
			url,
			title: github.title,
			content: capContent(github.content, maxCharacters),
			error: null,
			source: "github",
		};
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return {
			url,
			title: "",
			content: "",
			error: "Invalid URL",
			source: "http",
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			url,
			title: "",
			content: "",
			error: "Only http(s) URLs are supported.",
			source: "http",
		};
	}

	try {
		const httpResult = await extractHttp(url, maxCharacters, signal);
		if (!httpResult.error) return httpResult;
	} catch (error) {
		if (errorMessage(error).toLowerCase().includes("abort")) throw error;
	}

	try {
		const exaResult = await fetchWithExa(url, maxCharacters);
		if (exaResult) {
			return { url, ...exaResult, error: null, source: "exa" };
		}
	} catch (error) {
		if (errorMessage(error).toLowerCase().includes("abort")) throw error;
		return {
			url,
			title: "",
			content: "",
			error: errorMessage(error),
			source: "exa",
		};
	}

	return {
		url,
		title: "",
		content: "",
		error: "Could not extract content with HTTP or Exa.",
		source: "exa",
	};
}

export async function fetchMany(
	urls: string[],
	options: {
		maxCharacters?: number;
		forceClone?: boolean;
	} = {},
	signal?: AbortSignal,
): Promise<FetchResult[]> {
	const limit = pLimit(CONCURRENCY);
	return Promise.all(
		urls.map((url) => limit(() => fetchOne(url, options, signal))),
	);
}
