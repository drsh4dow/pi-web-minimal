export const SEARCH_PREVIEW_CHARS = 8_000;
export const FETCH_INLINE_CHARS = 30_000;
export const CONTENT_RETRIEVAL_CHARS = 50_000;
export const DEFAULT_FETCH_MAX_CHARS = 100_000;

export interface TruncatedText {
	text: string;
	truncated: boolean;
	fullChars: number;
}

export function truncateText(text: string, maxChars: number): TruncatedText {
	if (text.length <= maxChars) {
		return { text, truncated: false, fullChars: text.length };
	}
	return {
		text: `${text.slice(0, maxChars)}\n\n[Content truncated]`,
		truncated: true,
		fullChars: text.length,
	};
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function formatChars(chars: number): string {
	if (chars < 1000) return `${chars} chars`;
	return `${(chars / 1000).toFixed(1)}k chars`;
}
