import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { fetchLimits, fetchModelDetails, fmtPct, listModels, pct } from "../lib/dial-bin.js";

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

function fmtPrice(unitPrice: string | undefined): string {
	if (!unitPrice) return "n/a";
	const n = Number(unitPrice);
	if (!Number.isFinite(n) || n === 0) return "free";
	return `$${(n * 1_000_000).toFixed(2)}/M tokens`;
}

function listTrueKeys(rec: Record<string, unknown> | undefined): string[] {
	if (!rec) return [];
	return Object.entries(rec)
		.filter(([, v]) => v === true)
		.map(([k]) => k)
		.sort();
}

async function runInfo(ctx: ExtensionContext, modelId?: string) {
	const targetId = modelId || (ctx.model?.provider === "dial" ? ctx.model.id : undefined);
	if (!targetId) {
		ctx.ui.notify("[pi-dial] no active DIAL model", "warning");
		return;
	}

	const [details, limits] = await Promise.all([fetchModelDetails(targetId), fetchLimits(targetId)]);

	const lines: string[] = [`=== ${targetId} ===`];

	if (!details) {
		lines.push("(details unavailable — DIAL CLI returned nothing)");
	} else {
		const dn = [details.display_name, details.display_version].filter(Boolean).join(" ");
		if (dn) lines.push(`Display name : ${dn}`);
		if (details.lifecycle_status) lines.push(`Lifecycle    : ${details.lifecycle_status}`);
		if (details.tokenizer_model) lines.push(`Tokenizer    : ${details.tokenizer_model}`);
		if (details.description) lines.push(`Description  : ${details.description}`);

		if (details.pricing) {
			lines.push("");
			lines.push("Pricing:");
			lines.push(`  prompt     : ${fmtPrice(details.pricing.prompt)}`);
			lines.push(`  completion : ${fmtPrice(details.pricing.completion)}`);
			if (details.pricing.unit) lines.push(`  unit       : ${details.pricing.unit}`);
		}

		if (details.limits) {
			lines.push("");
			lines.push("Limits (model):");
			for (const [k, v] of Object.entries(details.limits)) {
				lines.push(`  ${k.padEnd(22)}: ${typeof v === "number" ? v.toLocaleString() : String(v)}`);
			}
		}

		const caps = listTrueKeys(details.capabilities);
		if (caps.length) {
			lines.push("");
			lines.push(`Capabilities : ${caps.join(", ")}`);
		}
		const feats = listTrueKeys(details.features);
		if (feats.length) lines.push(`Features     : ${feats.join(", ")}`);

		if (details.input_attachment_types?.length) {
			lines.push(`Attachments  : ${details.input_attachment_types.join(", ")}`);
		}

		if (details.headers && Object.keys(details.headers).length) {
			lines.push("");
			lines.push("Headers:");
			for (const [k, v] of Object.entries(details.headers)) lines.push(`  ${k}: ${v}`);
		}
	}

	const fmtQuota = (label: string, s: { used?: number; total?: number } | undefined) => {
		if (!s) return;
		lines.push(`  ${label.padEnd(11)}: ${s.used?.toLocaleString() ?? "n/a"} / ${s.total?.toLocaleString() ?? "n/a"} (${fmtPct(s.used, s.total)})`);
	};
	if (limits?.dayTokenStats || limits?.minuteTokenStats) {
		lines.push("");
		lines.push("Quota usage:");
		fmtQuota("day", limits.dayTokenStats);
		fmtQuota("minute", limits.minuteTokenStats);
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
	const value = `min ${fmtPct(m.used, m.total)} · day ${fmtPct(d.used, d.total)}`;
	ctx.ui.setStatus("dial", value);
	ctx.ui.notify(`dial: ${value}`, "info");
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
