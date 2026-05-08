---
name: dial
description: Query the DIAL AI model catalog, inspect a specific model's details/capabilities, or check rate-limit usage via the local `dial` CLI shipped with the pi-dial package. Trigger when the user asks about DIAL models, "what openweight/Anthropic/GPT model is available", token quotas / rate limits, or wants to look up a model id served via EPAM's DIAL proxy.
allowed-tools: Bash(dial:*), Read
---

# DIAL CLI Skill

Interact with EPAM's DIAL AI proxy service to discover models, check capabilities, and monitor usage quotas.

## Setup

**Required**: `DIAL_API_KEY` environment variable.

```bash
export DIAL_API_KEY="your-api-key"
```

**CLI discovery**: the `pi-dial` extension auto-prepends its `bin/` directory
to `PATH` when it loads — so `dial` is invokable directly from any shell pi
spawns (subagents, skills, hooks). If you see `dial: command not found`,
the extension hasn't loaded; verify the package is installed and the binary
was built (`cd <pi-dial>/dial-cli && go build -o ../bin/dial[.exe] .`).

## Core Commands

### List Available Models

Show models your API key can access (cached by default):

```bash
dial models list
```

**Flags**:
| Flag | Description |
|------|-------------|
| `--all` | Show capabilities, tools, and pricing |
| `--catalog` | Fetch full model catalog (not filtered by access) |
| `--filter <text>` | Filter by partial ID or name match |
| `--json` | Output as JSON |

**Examples**:

```bash
# Show all available models with full details
dial models list --all

# Filter for GPT-5 models only
dial models list --filter gpt-5

# Get full catalog including models you can't access
dial models list --catalog
```

### Get Model Details

View full metadata for a specific model:

```bash
dial models <model_id>
dial models <model_id> --all
```

**Examples**:

```bash
dial models gpt-5-mini-2025-08-07
dial models deepseek-r1 --all
dial models claude-sonnet-4@20250514 --all --json
```

### Check Rate Limits

View quotas and usage for a model:

```bash
dial models <model_id> limits
dial models <model_id> limits --json
```

**Examples**:

```bash
dial models gpt-5-mini-2025-08-07 limits
dial models gpt-4.1-nano-2025-04-14 limits --json
dial models deepseek-r1 limits --json
```

**Output includes**:
- Token quotas (minute/day/week/month)
- Request quotas (hour/day)
- Cost tracking (if enabled)
- Used vs remaining values

### Check Current Rate Limits for All Models

Get limits for multiple models at once using a loop:

```bash
# Check limits for top models
for model in gpt-5-mini-2025-08-07 gpt-4o deepseek-r1; do
  echo "=== $model ==="
  dial models "$model" limits
done
```

Or with JSON output for programmatic parsing:

```bash
# Get limits for all GPT-5 models
for model in $(dial models list --filter gpt-5 --catalog | grep -oE 'gpt-[0-9]+[^[:space:]]*'); do
  dial models "$model" limits --json
done
```

### Understanding Rate Limit Output

**Token Quotas**: Per-window token limits

| Window | Description | Typical Values |
|--------|-------------|----------------|
| Minute | Tokens per minute | 120K - unlimited |
| Day | Tokens per day | 1M - unlimited |
| Week | Tokens per week | unlimited |
| Month | Tokens per month | 20M - unlimited |

**Request Quotas**: Requests per window

| Window | Description | Typical Values |
|--------|-------------|----------------|
| Hour | Requests per hour | unlimited |
| Day | Requests per day | unlimited |

**Special values**:
- `unlimited` - No quota cap (shown for minuteTokenStats.total = 0 with remaining)
- `0 remaining` - Access restricted or quota exhausted

**Example output**:

```
Rate limits for: gpt-5-mini-2025-08-07

=== TOKEN QUOTAS ===
WINDOW          TOTAL            USED            REMAINING
Minute          120.0K           10              119.9K
Day             1.0M             50.2K           949.8K
Week            unlimited        996.2K          unlimited
Month           20.0M            996.2K          19.0M

=== REQUEST QUOTAS ===
WINDOW          TOTAL            USED
Hour            unlimited        0
Day             unlimited        0

STATUS: Available (minuteTokenStats.total > 0)
```

**No access indicator**:
```
STATUS: No access (minuteTokenStats.total = 0)
The API key cannot use this model.
```

### Refresh Model Cache

Re-check which models your API key can access:

```bash
dial models refresh
```

This queries all models and caches the list of accessible ones. Run when you get new model permissions.

## Quick Reference

| Task | Command |
|------|---------|
| List my models | `dial models list` |
| Full catalog | `dial models list --catalog` |
| Model details | `dial models gpt-5-mini-2025-08-07` |
| Rate limits | `dial models gpt-5-mini-2025-08-07 limits` |
| JSON output | `... --json` |
| With pricing/features | `... --all` |
| Filter models | `dial models list --filter gpt` |
| Refresh cache | `dial models refresh` |

## Filter Examples

```bash
# OpenAI models
dial models list --filter gpt

# Claude models
dial models list --filter claude

# DeepSeek models
dial models list --filter deepseek

# Embedding models
dial models list --filter embedding
```

## Common Models Reference

| Model ID | Name | Pricing (per 1M tokens) | Best For |
|----------|------|------------------------|----------|
| `gpt-5-nano-2025-08-07` | GPT-5 nano | $0.05 / $0.40 | Fastest, cheapest |
| `gpt-5-mini-2025-08-07` | GPT-5 mini | $0.25 / $2.00 | Balanced reasoning + tools |
| `gpt-5.5-2026-04-24` | GPT-5.5 | $5.00 / $30.00 | Most capable, agentic |
| `gpt-4o` | GPT-4o | $2.50 / $10.00 | General purpose |
| `deepseek-r1` | DeepSeek R1 | $1.48 / $5.94 | Chain-of-thought reasoning |
| `meta.llama4-scout-17b-instruct-v1:0` | Llama 4 Scout | $0.24 / $0.97 | Long context (3.5M+ tokens) |
| `gemini-2.5-flash` | Gemini 2.5 Flash | $0.30 / $2.50 | Fast, affordable |
| `gpt-oss-120b` | GPT OSS 120B | $0.15 / $0.60 | Open-weight, Apache 2.0 |

## Checking Current Usage Patterns

### Monitor Quota Usage Over Time

```bash
# Capture current limits to a file
dial models gpt-5-mini-2025-08-07 limits > limits_$(date +%Y%m%d_%H%M%S).txt

# Compare with previous snapshot
diff limits_20250508_143000.txt limits_20250509_090000.txt
```

### Check Which Models Have Highest Remaining Quota

```bash
# List models with large remaining day quota
for model in gpt-5-mini-2025-08-07 gpt-4o deepseek-r1; do
  limit=$(dial models "$model" limits --json | jq -r '.dayTokenStats.total')
  used=$(dial models "$model" limits --json | jq -r '.dayTokenStats.used')
  if [ "$limit" != "null" ] && [ "$limit" -gt 0 ]; then
    echo "$model: $(echo "scale=1; ($limit - $used) / 1000000" | bc)M remaining"
  fi
done
```

## When to Use This Skill

Invoke when the user needs to:

- Discover what AI models are available
- Check model capabilities (tools, context limits, pricing)
- Verify if they have access to a specific model
- Check rate limits and remaining quotas
- Compare models by features or cost
- Filter catalog by provider or model family
- Refresh cached model access list
- Monitor usage and quota depletion
- Plan requests based on remaining allowances