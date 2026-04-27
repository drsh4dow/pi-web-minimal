import { describe, expect, test } from "bun:test";
import { getContext7ApiKey, getExaApiKey } from "./lib/config.ts";
import { searchDocumentation } from "./lib/context7.ts";
import { searchCode, searchWeb } from "./lib/exa.ts";
import { fetchOne } from "./lib/fetch.ts";

const env = process.env as { RUN_LIVE_TESTS?: string; CI?: string };
const runLive = env.RUN_LIVE_TESTS === "1" || env.CI === "true";
const requireSecrets = env.CI === "true";
const exaLiveTest =
	runLive && (requireSecrets || getExaApiKey()) ? test : test.skip;
const context7LiveTest =
	runLive && (requireSecrets || getContext7ApiKey()) ? test : test.skip;

describe("live integrations", () => {
	exaLiveTest("Exa web search returns sources", async () => {
		expect(getExaApiKey()).toBeTruthy();
		const result = await searchWeb("official Example Domain page", {
			numResults: 2,
			domainFilter: ["example.com"],
		});
		expect(result.results.length).toBeGreaterThan(0);
		expect(
			result.results.some((item) => item.url?.includes("example.com")),
		).toBe(true);
	});

	exaLiveTest(
		"Exa fetch fallback path can retrieve known content",
		async () => {
			expect(getExaApiKey()).toBeTruthy();
			const result = await fetchOne("https://example.com", {
				maxCharacters: 5000,
			});
			expect(result.error).toBeNull();
			expect(result.content.toLowerCase()).toContain("documentation examples");
		},
	);

	exaLiveTest("Exa code search returns programming context", async () => {
		expect(getExaApiKey()).toBeTruthy();
		const result = await searchCode(
			"TypeScript Array map official documentation example",
			4000,
		);
		expect(result.results.length).toBeGreaterThan(0);
	});

	context7LiveTest("Context7 documentation search returns docs", async () => {
		expect(getContext7ApiKey()).toBeTruthy();
		const result = await searchDocumentation({
			library: "react",
			query: "useState hook",
		});
		expect(result.libraryId.length).toBeGreaterThan(0);
		expect(result.content.toLowerCase()).toContain("usestate");
	});
});
