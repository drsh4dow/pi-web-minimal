import { execFile } from "node:child_process";
import {
	closeSync,
	existsSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";

const ROOT = join(tmpdir(), "pi-github-repos");
const MAX_TREE_ENTRIES = 200;
const MAX_FILE_CHARS = 100_000;

const BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".ico",
	".pdf",
	".zip",
	".gz",
	".tar",
	".mp4",
	".mov",
	".mp3",
	".woff",
	".woff2",
]);

const NOISE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	"target",
	".next",
	"vendor",
]);

export interface GitHubUrlInfo {
	owner: string;
	repo: string;
	ref?: string;
	path?: string;
	type: "root" | "blob" | "tree";
}

export interface GitHubContent {
	url: string;
	title: string;
	content: string;
	localPath: string;
}

const cloneCache = new Map<string, Promise<string | null>>();

export function clearCloneCache(): void {
	cloneCache.clear();
}

export function parseGitHubUrl(input: string): GitHubUrlInfo | null {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		return null;
	}
	if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
		return null;
	}
	const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
	if (parts.length < 2) return null;
	const owner = parts[0];
	const repo = parts[1]?.replace(/\.git$/, "");
	if (!owner || !repo) return null;
	if (parts.length === 2) return { owner, repo, type: "root" };
	const action = parts[2];
	if ((action !== "blob" && action !== "tree") || !parts[3]) return null;
	return {
		owner,
		repo,
		ref: parts[3],
		path: parts.slice(4).join("/"),
		type: action,
	};
}

function cacheKey(info: GitHubUrlInfo): string {
	return `${info.owner}/${info.repo}${info.ref ? `@${info.ref}` : ""}`;
}

function clonePath(info: GitHubUrlInfo): string {
	return join(
		ROOT,
		info.owner,
		info.ref ? `${info.repo}@${info.ref}` : info.repo,
	);
}

function cloneRepo(
	info: GitHubUrlInfo,
	forceClone: boolean,
): Promise<string | null> {
	const key = cacheKey(info);
	if (!forceClone) {
		const cached = cloneCache.get(key);
		if (cached) return cached;
	}

	const localPath = clonePath(info);
	const promise = new Promise<string | null>((resolvePromise) => {
		try {
			if (forceClone) rmSync(localPath, { recursive: true, force: true });
			if (existsSync(join(localPath, ".git"))) {
				resolvePromise(localPath);
				return;
			}
			mkdirSync(join(ROOT, info.owner), { recursive: true });
		} catch {
			resolvePromise(null);
			return;
		}

		const args = [
			"clone",
			"--depth",
			"1",
			"--single-branch",
			...(info.ref ? ["--branch", info.ref] : []),
			`https://github.com/${info.owner}/${info.repo}.git`,
			localPath,
		];
		const child = execFile("git", args, { timeout: 30_000 }, (error) => {
			if (error) {
				rmSync(localPath, { recursive: true, force: true });
				resolvePromise(null);
				return;
			}
			resolvePromise(localPath);
		});
		child.on("error", () => resolvePromise(null));
	});
	cloneCache.set(key, promise);
	return promise;
}

function isBinaryFile(filePath: string): boolean {
	if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) return true;
	let fd = -1;
	try {
		fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		for (let index = 0; index < bytesRead; index++) {
			if (buffer[index] === 0) return true;
		}
		return false;
	} catch {
		return false;
	} finally {
		if (fd >= 0) closeSync(fd);
	}
}

function safePath(root: string, relativePath: string): string | null {
	const target = resolve(root, relativePath || ".");
	const normalizedRoot = resolve(root);
	if (
		target !== normalizedRoot &&
		!target.startsWith(`${normalizedRoot}${sep}`)
	) {
		return null;
	}
	return target;
}

function listTree(root: string, relativePath = ""): string {
	const start = safePath(root, relativePath);
	if (!start || !existsSync(start)) return "Path not found.";
	const lines: string[] = [];
	const walk = (dir: string, prefix: string) => {
		if (lines.length >= MAX_TREE_ENTRIES) return;
		for (const entry of readdirSync(dir).sort()) {
			if (NOISE_DIRS.has(entry)) continue;
			const fullPath = join(dir, entry);
			const relative = prefix ? `${prefix}/${entry}` : entry;
			const stat = lstatSync(fullPath);
			lines.push(stat.isDirectory() ? `${relative}/` : relative);
			if (stat.isDirectory()) walk(fullPath, relative);
			if (lines.length >= MAX_TREE_ENTRIES) break;
		}
	};
	if (statSync(start).isDirectory()) walk(start, relativePath);
	else lines.push(relativePath);
	if (lines.length >= MAX_TREE_ENTRIES) lines.push("...");
	return lines.join("\n");
}

function readTextFile(filePath: string): string {
	if (isBinaryFile(filePath)) return "Binary file omitted.";
	const text = readFileSync(filePath, "utf8");
	if (text.length <= MAX_FILE_CHARS) return text;
	return `${text.slice(0, MAX_FILE_CHARS)}\n\n[File truncated]`;
}

function readReadme(root: string): string {
	for (const name of readdirSync(root)) {
		if (/^readme(\.|$)/i.test(name)) return readTextFile(join(root, name));
	}
	return "";
}

export async function extractGitHub(
	url: string,
	forceClone = false,
): Promise<GitHubContent | null> {
	const info = parseGitHubUrl(url);
	if (!info) return null;
	const localPath = await cloneRepo(info, forceClone);
	if (!localPath) {
		return {
			url,
			title: `${info.owner}/${info.repo}`,
			content: `Could not clone public GitHub repository ${info.owner}/${info.repo}.`,
			localPath: clonePath(info),
		};
	}

	const target = safePath(localPath, info.path ?? "");
	if (
		info.type === "blob" &&
		target &&
		existsSync(target) &&
		statSync(target).isFile()
	) {
		return {
			url,
			title: `${info.owner}/${info.repo}/${info.path ?? basename(target)}`,
			content: `Local path: ${target}\n\n${readTextFile(target)}`,
			localPath,
		};
	}

	const treePath = info.type === "root" ? "" : (info.path ?? "");
	const readme = info.type === "root" ? readReadme(localPath) : "";
	const content = [
		`Repository cloned to: ${localPath}`,
		"",
		"## Tree",
		listTree(localPath, treePath),
		...(readme ? ["", "## README", readme] : []),
	].join("\n");
	return {
		url,
		title: `${info.owner}/${info.repo}`,
		content,
		localPath,
	};
}
