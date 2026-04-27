import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import webMinimalExtension from "./extensions/web-minimal.ts";
import { splitDomainFilter } from "./lib/exa.ts";
import { CONTENT_RETRIEVAL_CHARS } from "./lib/format.ts";
import { parseGitHubUrl } from "./lib/github.ts";
import {
	clearResults,
	findStoredItem,
	getResult,
	type StoredWebData,
	storeResult,
} from "./lib/storage.ts";

function registeredTools() {
	const tools: Array<Parameters<ExtensionAPI["registerTool"]>[0]> = [];
	webMinimalExtension({
		registerTool(tool: Parameters<ExtensionAPI["registerTool"]>[0]) {
			tools.push(tool);
		},
		on() {},
		appendEntry() {},
	} as unknown as ExtensionAPI);
	return tools;
}

function firstText(result: unknown): string {
	const content = (result as { content?: Array<{ text?: string }> }).content;
	return content?.[0]?.text ?? "";
}

describe("pi-web-minimal extension", () => {
	test("registers only the minimal retrieval tools", () => {
		expect(registeredTools().map((tool) => tool.name)).toEqual([
			"web_search",
			"code_search",
			"documentation_search",
			"fetch_content",
			"get_search_content",
		]);
	});

	test("package metadata follows Pi package shape", async () => {
		const pkg = (await Bun.file("package.json").json()) as {
			exports?: string;
			files?: string[];
			pi?: { extensions?: string[] };
			dependencies?: {
				"exa-js"?: string;
				"@mozilla/readability"?: string;
				turndown?: string;
			};
			keywords?: string[];
		};
		expect(pkg.exports).toBe("./index.ts");
		expect(pkg.pi?.extensions).toEqual(["./extensions/web-minimal.ts"]);
		expect(pkg.files).toEqual([
			"extensions",
			"lib",
			"docs",
			"index.ts",
			"README.md",
		]);
		expect(pkg.keywords).toContain("pi-package");
		expect(pkg.keywords).toContain("retrieval");
		expect(pkg.dependencies?.["exa-js"]).toBeDefined();
		expect(pkg.dependencies?.["@mozilla/readability"]).toBeDefined();
		expect(pkg.dependencies?.turndown).toBeDefined();
	});

	test("tool metadata steers toward bounded retrieval", () => {
		const tools = new Map(registeredTools().map((tool) => [tool.name, tool]));
		expect(tools.get("web_search")?.description).toContain("bounded");
		expect(tools.get("fetch_content")?.description).toContain("bounded");
		expect(tools.get("get_search_content")?.description).toContain("bounded");
		expect(tools.get("get_search_content")?.promptSnippet).toContain(
			"maxCharacters",
		);
	});
});

describe("search option helpers", () => {
	test("splits include and exclude domain filters", () => {
		expect(
			splitDomainFilter(["github.com", "-reddit.com", " docs.example.com "]),
		).toEqual({
			includeDomains: ["github.com", "docs.example.com"],
			excludeDomains: ["reddit.com"],
		});
	});
});

describe("GitHub URL parsing", () => {
	test("parses repository roots", () => {
		expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
			owner: "owner",
			repo: "repo",
			type: "root",
		});
	});

	test("parses blob paths", () => {
		expect(
			parseGitHubUrl("https://github.com/owner/repo/blob/main/src/index.ts"),
		).toEqual({
			owner: "owner",
			repo: "repo",
			ref: "main",
			path: "src/index.ts",
			type: "blob",
		});
	});

	test("ignores non-GitHub URLs", () => {
		expect(parseGitHubUrl("https://example.com/owner/repo")).toBeNull();
	});
});

describe("storage", () => {
	test("stores and selects content by query and URL", () => {
		clearResults();
		const data: StoredWebData = {
			id: "abc",
			type: "fetch",
			timestamp: Date.now(),
			items: [
				{ key: "0", title: "A", url: "https://a.test", content: "A content" },
				{ key: "1", title: "B", query: "question", content: "B content" },
			],
		};
		storeResult(data);
		expect(getResult("abc")).toBe(data);
		expect(findStoredItem(data, { urlIndex: 0 })).toMatchObject({
			content: "A content",
		});
		expect(findStoredItem(data, { query: "question" })).toMatchObject({
			content: "B content",
		});
		expect(findStoredItem(data, { urlIndex: 9 })).toBe(
			"URL index 9 out of range.",
		);
	});

	test("stored content retrieval is bounded by default", async () => {
		clearResults();
		const content = "x".repeat(CONTENT_RETRIEVAL_CHARS + 1000);
		storeResult({
			id: "long",
			type: "fetch",
			timestamp: Date.now(),
			items: [{ key: "0", title: "Long", content }],
		});

		const tool = registeredTools().find(
			(candidate) => candidate.name === "get_search_content",
		);
		expect(tool).toBeDefined();
		const result = await tool?.execute(
			"call",
			{ responseId: "long", queryIndex: 0 },
			undefined,
			undefined,
			{} as never,
		);
		const text = firstText(result);
		expect(text.length).toBeLessThan(content.length);
		expect(text).toContain("[Content truncated]");
		expect(result?.details).toMatchObject({
			responseId: "long",
			truncated: true,
			chars: content.length,
			returnedChars: CONTENT_RETRIEVAL_CHARS,
		});
	});
});
