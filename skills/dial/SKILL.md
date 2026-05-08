---
name: dial
description: Query the DIAL AI model catalog, inspect a specific model's details/capabilities, or check rate-limit usage via the local `dial` CLI shipped with the pi-dial package. Trigger when the user asks about DIAL models, "what openweight/Anthropic/GPT model is available", token quotas / rate limits, or wants to look up a model id served via EPAM's DIAL proxy.
allowed-tools: Bash(dial:*)
---

# dial CLI skill

Thin wrapper over the `dial` CLI shipped with the `pi-dial` package. Use it to answer questions about DIAL models, capabilities, and rate limits — nothing more. Do not delegate to subagents.

## Prerequisites

- `DIAL_API_KEY` is set in the environment.
- `dial` is on `PATH` — the `pi-dial` extension auto-prepends `<pkg>/bin` on load.

## Commands

| Task | Command |
|------|---------|
| List accessible models | `dial models list` |
| Full catalog (incl. inaccessible) | `dial models list --catalog` |
| Filter list | `dial models list --filter <text>` |
| All metadata in list | `dial models list --all` |
| Model details | `dial models <id>` |
| Model details, all fields | `dial models <id> --all` |
| Rate limits / usage | `dial models <id> limits` |
| Refresh local cache | `dial models refresh` |

Add `--json` to any command for machine-parseable output.

## Output shapes

`dial models <id> --all --json` → object with `id`, `display_name`, `display_version`, `description`, `capabilities`, `features`, `pricing.{prompt,completion,unit}`, `limits.{max_completion_tokens,max_total_tokens}`, `lifecycle_status`, `tokenizer_model`.

`dial models <id> limits --json` → `{ minuteTokenStats: { used, total }, dayTokenStats: { used, total } }`. A `total` of `0` means no access; very large values mean unlimited.

## Tips

- Don't fabricate prices — read them from `pricing` on each call. DIAL pricing is not pinned in this skill on purpose.
- Use `--filter` before parsing — it's faster than `grep` and respects the CLI's match semantics.
- For programmatic lookups always pair with `--json` and pipe to `jq`.
