import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface StoredItem {
	key: string;
	title: string;
	url?: string;
	query?: string;
	content: string;
	error?: string | null;
}

export interface StoredWebData {
	id: string;
	type: "search" | "fetch" | "code" | "documentation";
	timestamp: number;
	items: StoredItem[];
	synthesis?: string;
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

function isStoredItem(value: unknown): value is StoredItem {
	if (!value || typeof value !== "object") return false;
	const item = value as {
		key?: unknown;
		title?: unknown;
		content?: unknown;
	};
	return (
		typeof item.key === "string" &&
		typeof item.title === "string" &&
		typeof item.content === "string"
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
		(data.synthesis === undefined || typeof data.synthesis === "string")
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
		url?: string;
		urlIndex?: number;
	},
): StoredItem | string {
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
	return `Specify queryIndex or urlIndex. Available:\n${available}`;
}
