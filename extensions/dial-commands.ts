import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { fetchLimits, fetchModelDetails, listModels, pct } from "../lib/dial-bin.js";

const SUBCOMMANDS = ["pick", "info", "status", "list"] as const;
type Sub = (typeof SUBCOMMANDS)[number];

const CAP_WARN = 95;

interface PickerRow {
	id: string;
	min: number | null;
	day: number | null;
	minUsed?: number;
	minTotal?: number;
	dayUsed?: number;
	dayTotal?: number;
	overCap: boolean;
}

function fmtPctCell(p: number | null): string {
	if (p === null) return "  — ";
	if (p < 1) return " <1%";
	return `${p.toFixed(0)}%`.padStart(4);
}

function fmtTokens(n: number | undefined): string {
	if (n === undefined || n === null) return "—";
	if (!Number.isFinite(n) || n >= 9_000_000_000_000_000_000) return "∞";
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function fmtUsage(pctVal: number | null, used?: number, total?: number): string {
	const tok = used === undefined && total === undefined ? "" : ` (${fmtTokens(used)}/${fmtTokens(total)})`;
	return `${fmtPctCell(pctVal)}${tok}`;
}

async function buildPickerRows(candidates: string[]): Promise<PickerRow[]> {
	const rows = await Promise.all(
		candidates.map(async (id): Promise<PickerRow> => {
			const lim = await fetchLimits(id);
			if (!lim) return { id, min: null, day: null, overCap: false };
			const m = lim.minuteTokenStats ?? {};
			const d = lim.dayTokenStats ?? {};
			const min = pct(m.used ?? 0, m.total ?? 0);
			const day = pct(d.used ?? 0, d.total ?? 0);
			return {
				id,
				min,
				day,
				minUsed: m.used,
				minTotal: m.total,
				dayUsed: d.used,
				dayTotal: d.total,
				overCap: min >= CAP_WARN || day >= CAP_WARN,
			};
		}),
	);
	return rows;
}

async function gatherCandidates(): Promise<string[]> {
	const all = await listModels();
	return all
		.filter((m) => m.chat_completion && m.tools)
		.map((m) => m.id);
}

async function runPicker(pi: ExtensionAPI, ctx: ExtensionContext, requestedId?: string) {
	const current = ctx.model;
	const currentId = current?.provider === "dial" ? current.id : undefined;

	if (requestedId) {
		const found = ctx.modelRegistry.find("dial", requestedId);
		if (!found) {
			ctx.ui.notify(`[pi-dial] unknown model: ${requestedId}`, "error");
			return;
		}
		const ok = await pi.setModel(found);
		if (ok) ctx.ui.notify(`dial → ${requestedId}`, "info");
		return;
	}

	if (!ctx.hasUI || typeof ctx.ui.select !== "function") {
		ctx.ui?.notify("[pi-dial] picker requires interactive UI; pass an id: /dial pick <model-id>", "warning");
		return;
	}

	ctx.ui.notify("[pi-dial] loading model usage…", "info");
	const candidates = await gatherCandidates();
	if (candidates.length === 0) {
		ctx.ui.notify("[pi-dial] no DIAL models available", "warning");
		return;
	}
	const rows = await buildPickerRows(candidates);

	rows.sort((a, b) => {
		if (a.id === currentId) return -1;
		if (b.id === currentId) return 1;
		if (a.overCap !== b.overCap) return a.overCap ? 1 : -1;
		return (a.day ?? 0) - (b.day ?? 0);
	});

	const labelToId = new Map<string, string>();
	const options = rows.map((r) => {
		const marker = r.id === currentId ? "●" : " ";
		const usage = `min ${fmtUsage(r.min, r.minUsed, r.minTotal)} · day ${fmtUsage(r.day, r.dayUsed, r.dayTotal)}`;
		const warn = r.overCap ? "  ⚠ over cap" : "";
		const label = `${marker} ${r.id.padEnd(48)} ${usage}${warn}`;
		labelToId.set(label, r.id);
		return label;
	});

	const picked = await ctx.ui.select("Pick a DIAL model", options);
	if (!picked) return;

	const targetId = labelToId.get(picked);
	if (!targetId || targetId === currentId) return;

	const found = ctx.modelRegistry.find("dial", targetId);
	if (!found) {
		ctx.ui.notify(`[pi-dial] model not registered: ${targetId}`, "error");
		return;
	}
	const ok = await pi.setModel(found);
	if (ok) ctx.ui.notify(`dial: ${currentId ?? "(none)"} → ${targetId}`, "info");
}

async function runInfo(ctx: ExtensionContext, modelId?: string) {
	const targetId = modelId || (ctx.model?.provider === "dial" ? ctx.model.id : undefined);
	if (!targetId) {
		ctx.ui.notify("[pi-dial] no active DIAL model", "warning");
		return;
	}

	const [details, limits] = await Promise.all([fetchModelDetails(targetId), fetchLimits(targetId)]);

	const lines: string[] = [`=== ${targetId} ===`];
	const displayName = details?.display_name ?? "details unavailable";
	lines.push(`Display name: ${displayName}`);

	if (details?.headers) {
		lines.push("\nHeaders:");
		for (const [k, v] of Object.entries(details.headers)) lines.push(`  ${k}: ${v}`);
	}

	if (limits?.dayTokenStats) {
		const d = limits.dayTokenStats;
		const p = d.total && d.total > 0 ? Math.round((d.used ?? 0) / d.total * 100) : null;
		lines.push(`\nDaily tokens: ${d.used?.toLocaleString() ?? "n/a"} / ${d.total?.toLocaleString() ?? "n/a"}${p == null ? "" : ` (${p}%)`}`);
	}
	if (limits?.minuteTokenStats) {
		const m = limits.minuteTokenStats;
		const p = m.total && m.total > 0 ? Math.round((m.used ?? 0) / m.total * 100) : null;
		lines.push(`Minute tokens: ${m.used?.toLocaleString() ?? "n/a"} / ${m.total?.toLocaleString() ?? "n/a"}${p == null ? "" : ` (${p}%)`}`);
	}

	ctx.ui.notify(lines.join("\n"), "info");
}

async function runStatus(ctx: ExtensionContext) {
	const id = ctx.model?.provider === "dial" ? ctx.model.id : undefined;
	if (!id) {
		ctx.ui.notify("[pi-dial] no active DIAL model", "warning");
		return;
	}
	const lim = await fetchLimits(id);
	if (!lim) {
		ctx.ui.setStatus("dial", "limits n/a");
		ctx.ui.notify("[pi-dial] limits unavailable", "warning");
		return;
	}
	const m = lim.minuteTokenStats ?? {};
	const d = lim.dayTokenStats ?? {};
	const minPct = m.total ? `${Math.min(100, Math.round(((m.used ?? 0) / m.total) * 100))}%` : "n/a";
	const dayPct = d.total ? `${Math.min(100, Math.round(((d.used ?? 0) / d.total) * 100))}%` : "n/a";
	ctx.ui.setStatus("dial", `min ${minPct} · day ${dayPct}`);
	ctx.ui.notify(`dial: min ${minPct} · day ${dayPct}`, "info");
}

async function runList(ctx: ExtensionContext) {
	const candidates = await gatherCandidates();
	if (candidates.length === 0) {
		ctx.ui.notify("[pi-dial] no DIAL models available", "warning");
		return;
	}
	ctx.ui.notify(`DIAL models (${candidates.length}):\n${candidates.join("\n")}`, "info");
}

function splitArgs(s: string): string[] {
	return s.trim().split(/\s+/).filter(Boolean);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("dial", {
		description: "DIAL: pick (interactive picker) | info [<id>] | status | list",
		getArgumentCompletions: (prefix: string) =>
			SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
		handler: async (args, ctx) => {
			const tokens = splitArgs(args);
			const sub = (tokens[0] || "pick") as Sub;
			const rest = tokens.slice(1);

			try {
				if (sub === "pick") {
					await runPicker(pi, ctx, rest[0]);
				} else if (sub === "info") {
					await runInfo(ctx, rest[0]);
				} else if (sub === "status") {
					await runStatus(ctx);
				} else if (sub === "list") {
					await runList(ctx);
				} else {
					ctx.ui.notify(`[pi-dial] unknown sub: ${sub}. Try: ${SUBCOMMANDS.join(", ")}`, "warning");
				}
			} catch (e) {
				console.error(`[pi-dial] /${"dial"} ${sub} failed: ${(e as Error).message}`);
				ctx.ui?.notify(`[pi-dial] error: ${(e as Error).message}`, "error");
			}
		},
	});

	// Re-show info when a DIAL model is restored across sessions (parity with old dial-info behavior).
	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider === "dial" && event.source === "restore") {
			await runInfo(ctx, event.model.id);
		}
	});
}
