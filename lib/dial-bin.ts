import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
	lifecycle_status?: string;
	pricing?: { prompt?: string; completion?: string };
	chat_completion?: boolean;
	tools?: boolean;
	auto_caching?: boolean;
	headers?: Record<string, string>;
}

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let cachedBin: string | undefined;

export function resolveDialBinary(): string {
	if (cachedBin) return cachedBin;
	const exe = process.platform === "win32" ? "dial.exe" : "dial";
	const candidates = [
		resolve(PKG_ROOT, "bin", exe),
		resolve(PKG_ROOT, "dial-cli", exe),
	];
	for (const c of candidates) {
		if (existsSync(c)) {
			cachedBin = c;
			return c;
		}
	}
	console.warn(
		`[pi-dial] ${exe} not found in ${candidates.join(" or ")}. ` +
		`Falling back to PATH. Build with: cd dial-cli && go build -o ../bin/${exe} .`,
	);
	cachedBin = exe;
	return exe;
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
	return runJson<DialDetails>(["models", modelId, "details", "--json"]);
}

export async function listModels(): Promise<DialModelMinimal[]> {
	const data = await runJson<DialModelMinimal[]>(["models", "list", "--json"]);
	return data ?? [];
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
