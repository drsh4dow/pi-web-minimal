import { requireContext7ApiKey } from "./config.ts";

const BASE_URL = "https://context7.com/api/v2";

export interface DocumentationResult {
	libraryId: string;
	libraryTitle: string;
	content: string;
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

export async function searchDocumentation(input: {
	library?: string;
	libraryId?: string;
	query: string;
}): Promise<DocumentationResult> {
	let libraryId = input.libraryId?.trim();
	let libraryTitle = libraryId ?? "";
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
		const first = data.results?.[0];
		if (!first?.id)
			throw new Error(`No Context7 library found for "${library}".`);
		libraryId = first.id;
		libraryTitle = first.title ?? first.id;
	}

	const contextParams = new URLSearchParams({
		libraryId,
		query: input.query,
		type: "txt",
	});
	const response = await context7Get("/context", contextParams);
	if (!response.ok) throw new Error(await context7Error(response));
	const content = (await response.text()).trim();
	if (!content)
		throw new Error("Context7 returned empty documentation context.");
	return { libraryId, libraryTitle, content };
}
