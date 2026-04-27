import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getContext7ApiKey, getExaApiKey } from "./lib/config.ts";

const env = process.env as {
	RUN_AGENT_EVAL?: string;
	PI_EVAL_MODEL?: string;
	PI_EVAL_PROVIDER?: string;
	PI_EVAL_API_KEY?: string;
	PI_EVAL_MAX_OUTPUT_CHARS?: string;
	PI_EVAL_TASK_TIMEOUT_MS?: string;
	PI_EVAL_SUITE_TIMEOUT_MS?: string;
};
const runAgentEval = env.RUN_AGENT_EVAL === "1";
const agentEvalTest = runAgentEval ? test : test.skip;

interface EvalTask {
	name: string;
	prompt: string;
	marker: string;
	tools: string[];
}

const tasks: EvalTask[] = [
	{
		name: "web search source discovery",
		prompt:
			'Use web_search with domainFilter ["example.com"] to find the official Example Domain page. Answer what the page is for. End with EVAL_PASS_WEB only if the tool result supports the answer.',
		marker: "EVAL_PASS_WEB",
		tools: ["web_search"],
	},
	{
		name: "direct fetch",
		prompt:
			"Use fetch_content for https://example.com. Answer with the phrase the page uses for documentation examples. End with EVAL_PASS_FETCH only if the fetched content supports the answer.",
		marker: "EVAL_PASS_FETCH",
		tools: ["fetch_content"],
	},
	{
		name: "code search",
		prompt:
			"Use code_search to find current documentation for TypeScript or JavaScript Array.prototype.map callback parameters. Answer with the callback parameters. End with EVAL_PASS_CODE only if the search evidence supports the answer.",
		marker: "EVAL_PASS_CODE",
		tools: ["code_search"],
	},
	{
		name: "documentation search",
		prompt:
			"Use documentation_search with library react and query useState hook. Answer what useState returns. End with EVAL_PASS_DOCS only if Context7 documentation supports the answer.",
		marker: "EVAL_PASS_DOCS",
		tools: ["documentation_search"],
	},
	{
		name: "github fetch",
		prompt:
			"Use fetch_content for https://github.com/octocat/Hello-World. Answer whether a repository tree or README content was returned. End with EVAL_PASS_GITHUB only if the fetch result supports the answer.",
		marker: "EVAL_PASS_GITHUB",
		tools: ["fetch_content"],
	},
	{
		name: "stored content retrieval",
		prompt:
			"Use fetch_content for https://example.com, then use get_search_content with the returned responseId and urlIndex 0. Answer whether the stored content mentions documentation examples. End with EVAL_PASS_STORED only after using get_search_content.",
		marker: "EVAL_PASS_STORED",
		tools: ["fetch_content", "get_search_content"],
	},
];

async function readTreeText(root: string): Promise<string> {
	let text = "";
	for (const entry of await readdir(root)) {
		const path = join(root, entry);
		const info = await stat(path);
		if (info.isDirectory()) {
			text += await readTreeText(path);
		} else {
			text += await readFile(path, "utf8");
		}
	}
	return text;
}

function requireEnv(name: "PI_EVAL_MODEL"): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required when RUN_AGENT_EVAL=1.`);
	return value;
}

describe("real Pi agent eval", () => {
	agentEvalTest(
		"completes coding/research workflows under a response budget",
		async () => {
			const model = requireEnv("PI_EVAL_MODEL");
			if (!getExaApiKey()) {
				throw new Error(
					"Exa API key is required through EXA_API_KEY or ~/.pi/web-search.json when RUN_AGENT_EVAL=1.",
				);
			}
			if (!getContext7ApiKey()) {
				throw new Error(
					"Context7 API key is required through CONTEXT7_API_KEY or ~/.pi/web-search.json when RUN_AGENT_EVAL=1.",
				);
			}

			const maxOutputChars = Number(env.PI_EVAL_MAX_OUTPUT_CHARS ?? 20_000);
			const timeoutMs = Number(env.PI_EVAL_TASK_TIMEOUT_MS ?? 180_000);
			const report: Array<Record<string, unknown>> = [];
			const failures: string[] = [];

			for (const task of tasks) {
				const sessionDir = await mkdtemp(
					join(tmpdir(), `pi-web-minimal-${task.name.replaceAll(" ", "-")}-`),
				);
				const args = [
					"--bun",
					"pi",
					"--no-extensions",
					"-e",
					".",
					"--no-builtin-tools",
					"--tools",
					"web_search,fetch_content,code_search,documentation_search,get_search_content",
					"--session-dir",
					sessionDir,
					"--model",
					model,
					"--append-system-prompt",
					"Evaluation run: use the requested pi-web-minimal tool(s), keep the final answer under 800 characters, and include the EVAL_PASS marker only when tool evidence supports it.",
					"-p",
					task.prompt,
				];
				const provider = env.PI_EVAL_PROVIDER;
				if (provider) {
					args.splice(args.indexOf("--model"), 0, "--provider", provider);
				}
				const apiKey = env.PI_EVAL_API_KEY;
				if (apiKey) {
					args.splice(
						args.indexOf("--append-system-prompt"),
						0,
						"--api-key",
						apiKey,
					);
				}

				const started = Date.now();
				const proc = Bun.spawn(["bunx", ...args], {
					cwd: import.meta.dir,
					env: { ...env, PI_OFFLINE: "0" },
					stderr: "pipe",
					stdout: "pipe",
				});
				const timer = setTimeout(() => proc.kill(), timeoutMs);
				const [exitCode, stdout, stderr] = await Promise.all([
					proc.exited,
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);
				clearTimeout(timer);
				const sessionText = await readTreeText(sessionDir);
				const missingTools = task.tools.filter(
					(tool) =>
						!new RegExp(`"toolName"\\s*:\\s*"${tool}"`).test(sessionText),
				);
				const outputChars = stdout.length + stderr.length;
				const passed =
					exitCode === 0 &&
					stdout.includes(task.marker) &&
					missingTools.length === 0 &&
					outputChars <= maxOutputChars;

				report.push({
					name: task.name,
					exitCode,
					outputChars,
					elapsedMs: Date.now() - started,
					markerFound: stdout.includes(task.marker),
					missingTools,
					passed,
				});
				if (!passed) {
					failures.push(
						`${task.name}: exit=${exitCode}, marker=${stdout.includes(task.marker)}, missingTools=${missingTools.join(",") || "none"}, outputChars=${outputChars}`,
					);
				}
			}

			await Bun.write(
				"/tmp/pi-web-minimal-agent-eval.json",
				`${JSON.stringify(report, null, 2)}\n`,
			);
			expect(failures).toEqual([]);
		},
		Number(env.PI_EVAL_SUITE_TIMEOUT_MS ?? 1_500_000),
	);
});
