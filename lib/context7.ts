import { requireContext7ApiKey } from "./config.ts";

const BASE_URL = "https://context7.com/api/v2";

export interface DocumentationCandidate {
	id: string;
	title: string;
	description?: string;
	totalSnippets?: number;
	score: number;
}

export interface DocumentationResult {
	libraryId: string;
	libraryTitle: string;
	content: string;
	candidates?: DocumentationCandidate[];
}

interface SearchResponse {
	results?: Array<{
		id?: string;
		title?: string;
		description?: string;
		totalSnippets?: number;
	}>;
}

async function context7Get(
	path: string,
	params: URLSearchParams,
): Promise<Response> {
	return fetch(`${BASE_URL}${path}?${params.toString()}`, {
		headers: { Authorization: `Bearer ${requireContext7ApiKey()}` },
		signal: AbortSignal.timeout(60_000),
	});
}

async function context7Error(response: Response): Promise<string> {
	let body = "";
	try {
		body = await response.text();
	} catch {}
	return `Context7 API error ${response.status}: ${body.slice(0, 300)}`;
}

function documentationQueries(query: string): string[] {
	const cleaned = query.trim();
	const queries = [cleaned];
	const words = cleaned.split(/\s+/).filter(Boolean);
	if (words.length > 2) queries.push(words.slice(0, 2).join(" "));
	const first = words[0];
	if (first && /^use[A-Z]/.test(first)) queries.push(`${first} hook`);
	return [...new Set(queries.filter(Boolean))];
}

function terms(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_.-]+/)
		.filter((word) => word.length >= 3);
}

function scoreCandidate(input: {
	library: string;
	query: string;
	id: string;
	title: string;
	description?: string;
	totalSnippets?: number;
}): number {
	const wanted = input.library.toLowerCase().replace(/^@/, "");
	const haystack =
		`${input.id} ${input.title} ${input.description ?? ""}`.toLowerCase();
	let score = 0;
	if (input.id.toLowerCase().endsWith(`/${wanted}`)) score += 40;
	if (input.title.toLowerCase() === wanted) score += 35;
	if (haystack.includes(wanted)) score += 20;
	for (const term of terms(input.query)) {
		if (haystack.includes(term)) score += 3;
	}
	if (typeof input.totalSnippets === "number") {
		score += Math.min(20, Math.log10(input.totalSnippets + 1) * 5);
	}
	return score;
}

function rankCandidates(
	data: SearchResponse,
	library: string,
	query: string,
): DocumentationCandidate[] {
	return (data.results ?? [])
		.filter(
			(result): result is Required<Pick<typeof result, "id">> & typeof result =>
				typeof result.id === "string" && result.id.length > 0,
		)
		.map((result) => {
			const title = result.title ?? result.id;
			return {
				id: result.id as string,
				title,
				description: result.description,
				totalSnippets: result.totalSnippets,
				score: scoreCandidate({
					library,
					query,
					id: result.id as string,
					title,
					description: result.description,
					totalSnippets: result.totalSnippets,
				}),
			};
		})
		.sort(
			(a, b) =>
				b.score - a.score || (b.totalSnippets ?? 0) - (a.totalSnippets ?? 0),
		);
}

export async function searchDocumentation(input: {
	library?: string;
	libraryId?: string;
	query: string;
}): Promise<DocumentationResult> {
	let libraryId = input.libraryId?.trim();
	let libraryTitle = libraryId ?? "";
	let candidates: DocumentationCandidate[] | undefined;
	if (!libraryId) {
		const library = input.library?.trim();
		if (!library) throw new Error("Provide library or libraryId.");
		const searchParams = new URLSearchParams({
			libraryName: library,
			query: input.query,
		});
		const response = await context7Get("/libs/search", searchParams);
		if (!response.ok) throw new Error(await context7Error(response));
		const data = (await response.json()) as SearchResponse;
		candidates = rankCandidates(data, library, input.query).slice(0, 5);
		const first = candidates[0];
		if (!first?.id)
			throw new Error(`No Context7 library found for "${library}".`);
		libraryId = first.id;
		libraryTitle = first.title;
	}

	let lastError = "";
	for (const query of documentationQueries(input.query)) {
		const contextParams = new URLSearchParams({
			libraryId,
			query,
			type: "txt",
		});
		const response = await context7Get("/context", contextParams);
		if (!response.ok) {
			lastError = await context7Error(response);
			if (!lastError.includes("no_snippets_found")) throw new Error(lastError);
			continue;
		}
		const content = (await response.text()).trim();
		if (content) return { libraryId, libraryTitle, content, candidates };
		lastError = "Context7 returned empty documentation context.";
	}
	throw new Error(
		lastError || "Context7 returned empty documentation context.",
	);
}
