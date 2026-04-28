import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const CACHE_TTL_MS = 60 * 60 * 1000;
const SESSION_ITEM_CHARS = 40_000;
const SESSION_TOTAL_CHARS = 160_000;

export interface StoredItem {
	key: string;
	title: string;
	url?: string;
	query?: string;
	content: string;
	contentChars?: number;
	error?: string | null;
}

export interface StoredWebData {
	id: string;
	type: "search" | "fetch" | "code" | "documentation";
	timestamp: number;
	items: StoredItem[];
	synthesis?: string;
	sessionTruncated?: boolean;
}

const stored = new Map<string, StoredWebData>();

export function generateId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function storeResult(data: StoredWebData): void {
	stored.set(data.id, data);
}

export function getResult(id: string): StoredWebData | null {
	return stored.get(id) ?? null;
}

export function clearResults(): void {
	stored.clear();
}

function truncateForSession(content: string, remaining: number): string {
	const maxChars = Math.max(0, Math.min(SESSION_ITEM_CHARS, remaining));
	if (content.length <= maxChars) return content;
	return `${content.slice(0, Math.max(0, maxChars))}\n\n[Session-stored content truncated; refetch for complete raw evidence]`;
}

export function compactForSession(data: StoredWebData): StoredWebData {
	let remaining = SESSION_TOTAL_CHARS;
	let sessionTruncated = false;
	const items = data.items.map((item) => {
		const originalChars = item.contentChars ?? item.content.length;
		const content = truncateForSession(item.content, remaining);
		remaining -= content.length;
		if (content.length < item.content.length) sessionTruncated = true;
		return {
			...item,
			content,
			contentChars: originalChars,
		};
	});
	return {
		...data,
		items,
		...(data.sessionTruncated || sessionTruncated
			? { sessionTruncated: true }
			: {}),
	};
}

function isStoredItem(value: unknown): value is StoredItem {
	if (!value || typeof value !== "object") return false;
	const item = value as {
		key?: unknown;
		title?: unknown;
		content?: unknown;
		contentChars?: unknown;
	};
	return (
		typeof item.key === "string" &&
		typeof item.title === "string" &&
		typeof item.content === "string" &&
		(item.contentChars === undefined || typeof item.contentChars === "number")
	);
}

function isStoredWebData(value: unknown): value is StoredWebData {
	if (!value || typeof value !== "object") return false;
	const data = value as {
		id?: unknown;
		type?: unknown;
		timestamp?: unknown;
		items?: unknown;
		synthesis?: unknown;
		sessionTruncated?: unknown;
	};
	return (
		typeof data.id === "string" &&
		(data.type === "search" ||
			data.type === "fetch" ||
			data.type === "code" ||
			data.type === "documentation") &&
		typeof data.timestamp === "number" &&
		Array.isArray(data.items) &&
		data.items.every(isStoredItem) &&
		(data.synthesis === undefined || typeof data.synthesis === "string") &&
		(data.sessionTruncated === undefined ||
			typeof data.sessionTruncated === "boolean")
	);
}

export function restoreFromSession(ctx: ExtensionContext): void {
	stored.clear();
	const now = Date.now();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== "web-minimal-results") {
			continue;
		}
		if (
			isStoredWebData(entry.data) &&
			now - entry.data.timestamp < CACHE_TTL_MS
		) {
			stored.set(entry.data.id, entry.data);
		}
	}
}

export function findStoredItem(
	data: StoredWebData,
	selector: {
		query?: string;
		queryIndex?: number;
		sourceIndex?: number;
		url?: string;
		urlIndex?: number;
	},
): StoredItem | string {
	if (selector.sourceIndex !== undefined) {
		return (
			data.items[selector.sourceIndex] ??
			`Source index ${selector.sourceIndex} out of range.`
		);
	}
	if (selector.query !== undefined) {
		const item = data.items.find(
			(candidate) => candidate.query === selector.query,
		);
		return item ?? `Query "${selector.query}" not found.`;
	}
	if (selector.queryIndex !== undefined) {
		return (
			data.items[selector.queryIndex] ??
			`Query index ${selector.queryIndex} out of range.`
		);
	}
	if (selector.url !== undefined) {
		const item = data.items.find((candidate) => candidate.url === selector.url);
		return item ?? `URL "${selector.url}" not found.`;
	}
	if (selector.urlIndex !== undefined) {
		return (
			data.items[selector.urlIndex] ??
			`URL index ${selector.urlIndex} out of range.`
		);
	}
	if (data.items.length === 1) return data.items[0] as StoredItem;
	const available = data.items
		.map((item, index) => `${index}: ${item.query ?? item.url ?? item.title}`)
		.join("\n");
	return `Specify sourceIndex, queryIndex, or urlIndex. Available:\n${available}`;
}
