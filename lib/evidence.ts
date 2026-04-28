export interface EvidenceSource {
	title: string;
	content: string;
	url?: string;
	query?: string;
	error?: string | null;
}

export interface EvidenceSnippet {
	sourceIndex: number;
	title: string;
	url?: string;
	query?: string;
	text: string;
	start: number;
	end: number;
	section?: string;
	score: number;
}

export interface EvidenceReport {
	text: string;
	snippets: EvidenceSnippet[];
	inputChars: number;
	selectedChars: number;
}

const INSTRUCTION_LINE =
	/ignore (all )?(previous|prior)|system\s*:|developer\s*:|assistant\s*:|tool\s*:|<\|im_|reveal|leak|secret|api key|exfiltrat|send .* to/i;

function words(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_.-]+/)
		.map((term) => term.trim())
		.filter((term) => term.length >= 4);
}

function uniqueTerms(source: EvidenceSource, task = ""): string[] {
	return [
		...new Set(words(`${task} ${source.query ?? ""} ${source.title ?? ""}`)),
	];
}

function cleanVisibleText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !INSTRUCTION_LINE.test(line))
		.join("\n")
		.trim();
}

function normalizeInline(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function sectionAt(text: string, offset: number): string | undefined {
	let current: string | undefined;
	for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
		if ((match.index ?? 0) > offset) break;
		current = match[1]?.trim();
	}
	return current;
}

function scoreWindow(window: string, terms: string[], start: number): number {
	const lower = window.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (lower.includes(term)) score += 8;
	}
	if (/^#{1,6}\s+/m.test(window)) score += 4;
	if (start === 0) score += 1;
	return score - Math.floor(start / 20_000);
}

function candidateStarts(text: string, terms: string[]): number[] {
	const starts = new Set<number>([0]);
	const lower = text.toLowerCase();
	for (const term of terms.slice(0, 24)) {
		let index = lower.indexOf(term);
		let seen = 0;
		while (index >= 0 && seen < 3) {
			starts.add(Math.max(0, index - 450));
			index = lower.indexOf(term, index + term.length);
			seen++;
		}
	}
	for (const match of text.matchAll(/^#{1,6}\s+.+$/gm)) {
		starts.add(match.index ?? 0);
	}
	return [...starts];
}

function bestSnippet(
	source: EvidenceSource,
	sourceIndex: number,
	task: string,
	maxChars: number,
): EvidenceSnippet | null {
	const raw = source.content.trim();
	if (!raw || source.error) return null;
	const terms = uniqueTerms(source, task);
	const starts = candidateStarts(raw, terms);
	let best = starts[0] ?? 0;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const start of starts) {
		const end = Math.min(raw.length, start + maxChars);
		const score = scoreWindow(raw.slice(start, end), terms, start);
		if (score > bestScore || (score === bestScore && start < best)) {
			best = start;
			bestScore = score;
		}
	}
	const end = Math.min(raw.length, best + maxChars);
	const cleaned = cleanVisibleText(raw.slice(best, end));
	const text = normalizeInline(cleaned || raw.slice(best, end)).slice(
		0,
		maxChars,
	);
	if (!text) return null;
	return {
		sourceIndex,
		title: source.title || "Untitled",
		url: source.url,
		query: source.query,
		text,
		start: best,
		end,
		section: sectionAt(raw, best),
		score: bestScore,
	};
}

export function selectEvidenceSnippets(
	sources: EvidenceSource[],
	options: {
		task?: string;
		maxTotalChars?: number;
		maxSnippetChars?: number;
	} = {},
): EvidenceReport {
	const task = options.task ?? "";
	const maxTotalChars = options.maxTotalChars ?? 24_000;
	const maxSnippetChars = options.maxSnippetChars ?? 1_800;
	const usable = sources.filter(
		(source) => !source.error && source.content.trim().length > 0,
	);
	const inputChars = usable.reduce(
		(total, source) => total + source.content.length,
		0,
	);
	if (usable.length === 0) {
		return { text: "", snippets: [], inputChars, selectedChars: 0 };
	}

	const perSource = Math.max(
		700,
		Math.min(maxSnippetChars, Math.floor(maxTotalChars / usable.length) - 220),
	);
	const snippets = sources
		.map((source, index) => bestSnippet(source, index, task, perSource))
		.filter((snippet): snippet is EvidenceSnippet => snippet !== null)
		.sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex);

	const sections: string[] = [];
	let selectedChars = 0;
	for (const snippet of snippets) {
		if (selectedChars >= maxTotalChars) break;
		const sourceRef = snippet.sourceIndex + 1;
		const locator = [
			`chars ${snippet.start}-${snippet.end}`,
			...(snippet.section ? [`section ${snippet.section}`] : []),
		].join("; ");
		const section = [
			`[S${sourceRef}]`,
			`Title: ${snippet.title}`,
			...(snippet.url ? [`URL: ${snippet.url}`] : []),
			...(snippet.query ? [`Query: ${snippet.query}`] : []),
			`Locator: ${locator}`,
			"Content:",
			snippet.text,
			`[/S${sourceRef}]`,
		].join("\n");
		if (selectedChars + section.length > maxTotalChars) break;
		sections.push(section);
		selectedChars += section.length;
	}

	return { text: sections.join("\n\n"), snippets, inputChars, selectedChars };
}

export function renderExtractiveReport(
	sources: EvidenceSource[],
	options: { task?: string; maxChars?: number; maxFindings?: number } = {},
): EvidenceReport {
	const maxChars = options.maxChars ?? 2_400;
	const findings = Math.max(1, options.maxFindings ?? 6);
	const selected = selectEvidenceSnippets(sources, {
		task: options.task,
		maxTotalChars: Math.max(4_000, maxChars * 3),
		maxSnippetChars: 1_200,
	});
	const lines = ["## Findings"];
	const snippets = selected.snippets.slice(0, findings);
	if (snippets.length === 0) {
		lines.push(
			"- No successful retrieved content was available to extract findings from.",
		);
	} else {
		for (const snippet of snippets) {
			const ref = snippet.sourceIndex + 1;
			const quote = normalizeInline(snippet.text).slice(0, 260);
			const locator = snippet.section
				? `section: ${snippet.section}; chars ${snippet.start}-${snippet.end}`
				: `chars ${snippet.start}-${snippet.end}`;
			lines.push(
				`- ${quote}${quote.endsWith(".") ? "" : "."} (${locator}) [S${ref}]`,
			);
		}
	}
	lines.push("", "## Source Manifest");
	for (let index = 0; index < sources.length; index++) {
		const source = sources[index] as EvidenceSource;
		const locator = source.url ?? source.query ?? "stored source";
		const status = source.error
			? `error: ${source.error}`
			: `${source.content.length} chars`;
		lines.push(
			`- [S${index + 1}] ${source.title || "Untitled"} — ${locator} — ${status}`,
		);
	}
	let text = lines.join("\n");
	if (text.length > maxChars) {
		text = `${text.slice(0, maxChars)}\n\n[Extractive report truncated]`;
	}
	return {
		text,
		snippets,
		inputChars: selected.inputChars,
		selectedChars: Math.min(text.length, selected.selectedChars),
	};
}

export function normalizeUrlForDedup(url: string | undefined): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		for (const key of [...parsed.searchParams.keys()]) {
			if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) {
				parsed.searchParams.delete(key);
			}
		}
		return parsed.toString().replace(/\/$/, "");
	} catch {
		return url.trim() || null;
	}
}
