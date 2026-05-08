import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { listModels, loadCachedModels } from "../lib/dial-bin.js";

const DIAL_HOST = "https://ai-proxy.lab.epam.com";

export default async function (pi: ExtensionAPI) {
	if (!process.env.DIAL_API_KEY) {
		console.warn("[pi-dial] DIAL_API_KEY not set — skipping provider registration");
		return;
	}

	const data = loadCachedModels() ?? (await listModels());
	if (data.length === 0) {
		console.warn("[pi-dial] dial-cli returned no models — provider not registered");
		return;
	}

	const useCompletionField = (id: string) => /^(gpt-5|gpt-4\.1|o[1-9])/i.test(id);
	const isAnthropic = (id: string) => /^anthropic\.|^claude/i.test(id);

	// DIAL exposes only `prompt` and `completion` per-token prices. It does NOT
	// publish cache-read or cache-write factors, and the proxy may not pass
	// through the upstream provider's discounts. We therefore charge cache
	// hits at the input price (truthful pessimistic estimate) instead of
	// applying public OpenAI/Anthropic factors that may not match DIAL billing.
	const models = data
		.filter((m) => m.chat_completion && m.tools)
		.map((m) => {
			const inputPrice = Number(m.pricing?.prompt ?? 0) * 1_000_000;
			const outputPrice = Number(m.pricing?.completion ?? 0) * 1_000_000;
			return {
				id: m.id,
				name: m.display_name ?? m.id,
				baseUrl: `${DIAL_HOST}/openai/deployments/${m.id}`,
				reasoning: /reasoning|thinking|^o[1-9]/i.test(m.id),
				input: ["text"] as const,
				cost: {
					input: inputPrice,
					output: outputPrice,
					cacheRead: inputPrice,
					cacheWrite: inputPrice,
				},
				contextWindow: 128000,
				maxTokens: 8000,
				compat: {
					maxTokensField: useCompletionField(m.id) ? "max_completion_tokens" : "max_tokens",
					supportsStore: false,
					...(isAnthropic(m.id) ? { cacheControlFormat: "anthropic" as const } : {}),
				},
			};
		});

	pi.registerProvider("dial", {
		baseUrl: DIAL_HOST,
		apiKey: "DIAL_API_KEY",
		api: "openai-completions",
		authHeader: false,
		headers: { "Api-Key": "DIAL_API_KEY" },
		models,
	});

	// DIAL adapters routing to AWS Bedrock Converse require tool result content to be a JSON object.
	pi.on("before_provider_request", (event) => {
		const payload = event?.payload as { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
		const messages = payload?.messages;
		if (!Array.isArray(messages)) return;

		let mutated = false;
		for (const msg of messages) {
			if (msg.role !== "tool") continue;
			const c = msg.content;
			if (typeof c !== "string") continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(c);
			} catch {
				parsed = undefined;
			}
			const isObject = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
			if (isObject) continue;
			msg.content = JSON.stringify({ output: parsed === undefined ? c : parsed });
			mutated = true;
		}
		return mutated ? payload : undefined;
	});
}
