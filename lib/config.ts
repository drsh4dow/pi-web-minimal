import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

const env = process.env as {
	EXA_API_KEY?: string;
	CONTEXT7_API_KEY?: string;
};

interface WebConfig {
	exaApiKey?: unknown;
	context7ApiKey?: unknown;
}

let cachedConfig: WebConfig | null = null;

function loadConfig(): WebConfig {
	if (cachedConfig) return cachedConfig;
	if (!existsSync(CONFIG_PATH)) {
		cachedConfig = {};
		return cachedConfig;
	}

	const raw = readFileSync(CONFIG_PATH, "utf8");
	try {
		cachedConfig = JSON.parse(raw) as WebConfig;
		return cachedConfig;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
	}
}

function cleanKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const key = value.trim();
	return key.length > 0 ? key : null;
}

export function getExaApiKey(): string | null {
	return cleanKey(env.EXA_API_KEY) ?? cleanKey(loadConfig().exaApiKey);
}

export function getContext7ApiKey(): string | null {
	return (
		cleanKey(env.CONTEXT7_API_KEY) ?? cleanKey(loadConfig().context7ApiKey)
	);
}

export function requireExaApiKey(): string {
	const key = getExaApiKey();
	if (key) return key;
	throw new Error(
		`Exa API key not found. Set EXA_API_KEY or add { "exaApiKey": "exa-..." } to ${CONFIG_PATH}.`,
	);
}

export function requireContext7ApiKey(): string {
	const key = getContext7ApiKey();
	if (key) return key;
	throw new Error(
		`Context7 API key not found. Set CONTEXT7_API_KEY or add { "context7ApiKey": "ctx7sk-..." } to ${CONFIG_PATH}.`,
	);
}
