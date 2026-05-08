import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { fetchLimits, fmtPct } from "../lib/dial-bin.js";

const POLL_MS = 60_000;
const STATUS_KEY = "dial";

export default function (pi: ExtensionAPI) {
	let timer: NodeJS.Timeout | undefined;
	let currentModelId: string | undefined;
	let lastValue: string | undefined;

	function setStatus(ctx: ExtensionContext, value: string) {
		if (value === lastValue) return;
		lastValue = value;
		ctx.ui.setStatus(STATUS_KEY, value);
	}

	async function poll(ctx: ExtensionContext, modelId: string) {
		const lim = await fetchLimits(modelId);
		if (!lim) {
			setStatus(ctx, "limits n/a");
			return;
		}
		const m = lim.minuteTokenStats ?? {};
		const d = lim.dayTokenStats ?? {};
		setStatus(ctx, `min ${fmtPct(m.used, m.total)} · day ${fmtPct(d.used, d.total)}`);
	}

	function stop(ctx?: ExtensionContext) {
		if (timer) clearInterval(timer);
		timer = undefined;
		currentModelId = undefined;
		lastValue = undefined;
		ctx?.ui.setStatus(STATUS_KEY, "");
	}

	function start(ctx: ExtensionContext, modelId: string) {
		if (timer) clearInterval(timer);
		currentModelId = modelId;
		setStatus(ctx, "loading…");
		void poll(ctx, modelId);
		timer = setInterval(() => {
			if (currentModelId) void poll(ctx, currentModelId);
		}, POLL_MS);
		if (typeof timer.unref === "function") timer.unref();
	}

	pi.on("session_start", async (_ev, ctx) => {
		if (!ctx.hasUI) return;
		const m = ctx.model;
		if (m?.provider === "dial") start(ctx, m.id);
	});

	pi.on("model_select", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.model.provider === "dial") start(ctx, event.model.id);
		else stop(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});
}
