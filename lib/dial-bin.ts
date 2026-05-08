import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DialModelMinimal {
	id: string;
	display_name?: string;
	lifecycle_status?: string;
	pricing?: { prompt?: string; completion?: string };
	chat_completion?: boolean;
	tools?: boolean;
	auto_caching?: boolean;
}

export interface DialLimits {
	minuteTokenStats?: { total?: number; used?: number };
	dayTokenStats?: { total?: number; used?: number };
	headers?: Record<string, string>;
}

export interface DialDetails {
	id?: string;
	display_name?: string;
	display_version?: string;
	description?: string;
	lifecycle_status?: string;
	tokenizer_model?: string;
	capabilities?: Record<string, unknown>;
	features?: Record<string, unknown>;
	input_attachment_types?: string[];
	limits?: { max_completion_tokens?: number; max_total_tokens?: number; [k: string]: unknown };
	defaults?: Record<string, unknown>;
	pricing?: { prompt?: string; completion?: string; unit?: string };
	chat_completion?: boolean;
	tools?: boolean;
	auto_caching?: boolean;
	headers?: Record<string, string>;
}

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = process.platform === "win32" ? "dial.exe" : "dial";

function findLocalBinary(): { path: string; dir: string } | null {
	for (const dir of [resolve(PKG_ROOT, "bin"), resolve(PKG_ROOT, "dial-cli")]) {
		const p = resolve(dir, EXE);
		if (existsSync(p)) return { path: p, dir };
	}
	return null;
}

function injectIntoPath(binDir: string): void {
	const cur = process.env.PATH ?? "";
	const parts = cur.split(delimiter);
	if (parts.some((p) => p && resolve(p) === resolve(binDir))) return;
	process.env.PATH = `${binDir}${delimiter}${cur}`;
}

const localBin = findLocalBinary();
if (localBin) {
	injectIntoPath(localBin.dir);
} else {
	console.warn(
		`[pi-dial] ${EXE} not found in <pkg>/bin or <pkg>/dial-cli. ` +
		`Falling back to PATH lookup. Build with: cd dial-cli && go build -o ../bin/${EXE} .`,
	);
}

export function resolveDialBinary(): string {
	return localBin?.path ?? EXE;
}

async function runJson<T>(args: string[]): Promise<T | null> {
	try {
		const { stdout } = await execFileAsync(resolveDialBinary(), args, {
			timeout: 8_000,
			maxBuffer: 16 * 1024 * 1024,
		});
		return JSON.parse(stdout) as T;
	} catch {
		return null;
	}
}

export function fetchLimits(modelId: string): Promise<DialLimits | null> {
	return runJson<DialLimits>(["models", modelId, "limits", "--json"]);
}

export function fetchModelDetails(modelId: string): Promise<DialDetails | null> {
	return runJson<DialDetails>(["models", modelId, "--all", "--json"]);
}

export async function listModels(): Promise<DialModelMinimal[]> {
	const data = await runJson<DialModelMinimal[]>(["models", "list", "--json"]);
	return data ?? [];
}

// Read the dial-cli cache directly from ~/.dial-cache.json. Skips spawning
// the CLI when the cache is warm — the CLI itself never expires this file
// (only `dial models refresh` rewrites it), so this matches CLI semantics.
export function loadCachedModels(): DialModelMinimal[] | null {
	const path = join(homedir(), ".dial-cache.json");
	if (!existsSync(path)) return null;
	try {
		// Cache stores raw DIAL API shape (capabilities.chat_completion, features.tools);
		// CLI's `models list` flattens these to top-level booleans. Normalize on read
		// so consumers see the same shape regardless of source.
		type Raw = DialModelMinimal & {
			capabilities?: { chat_completion?: boolean };
			features?: { tools?: boolean };
		};
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: Raw[] };
		const raw = parsed?.models;
		if (!Array.isArray(raw) || raw.length === 0) return null;
		return raw.map((m) => ({
			...m,
			chat_completion: m.chat_completion ?? m.capabilities?.chat_completion,
			tools: m.tools ?? m.features?.tools,
		}));
	} catch {
		return null;
	}
}

export function pct(used: number, total: number): number {
	if (!total || total >= 9_000_000_000_000_000_000) return 0;
	return Math.min(100, (used / total) * 100);
}

export function fmtPct(used: number | undefined, total: number | undefined): string {
	const u = used ?? 0;
	const t = total ?? 0;
	if (!t || t >= 9_000_000_000_000_000_000) return "∞";
	const p = Math.min(100, (u / t) * 100);
	return p < 1 ? "<1%" : `${p.toFixed(0)}%`;
}
