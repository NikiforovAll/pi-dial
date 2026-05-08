# pi-dial

DIAL ([ai-proxy.lab.epam.com](https://ai-proxy.lab.epam.com)) integration for the [pi coding agent](https://pi.dev): provider registration, usage status bar, model details, and an **interactive model picker** to swap models on demand.

> Local-only package. Not published to npm — install from a sibling checkout.

## Install

1. Clone next to your pi project:

   ```sh
   git clone https://github.com/NikiforovAll/pi-dial
   ```

2. Build the Go CLI once (see [dial-cli/README.md](./dial-cli/README.md)):

   ```sh
   cd ./pi-dial && npm run build:cli
   ```

3. Add to `.pi/settings.json` of the pi project:

   ```bash
   npm install ./pi-dial
   ```

4. Export your DIAL key:

   ```sh
   export DIAL_API_KEY=...
   ```

5. Restart pi. You should see DIAL models in `/model` and the `/dial` slash command available.

## Commands

```
/dial pick           interactive picker for configured DIAL models
/dial pick <id>      switch directly to <id>
/dial info [<id>]    print model details + per-min/per-day token limits
/dial status         force a one-shot status-bar refresh
```

## Configuration

In `.pi/settings.json`:

```json
{
  "defaultProvider": "dial",
  "dial": {
    "model":       ["dial/gpt-5.5-2026-04-24"],
    "small_model": ["dial/moonshotai.kimi-k2.5"]
  }
}
```

The picker lists `small_model + model` as candidates. Models marked over the
95% per-day or per-minute cap are flagged but still selectable.

## Recording a demo

To record `pi-dial` running against a throwaway test project:

```sh
mkdir /tmp/pi-dial-demo && cd /tmp/pi-dial-demo
git init -q
# point this scratch project at the same local pi-dial install:
mkdir -p .pi/npm
cat > .pi/npm/package.json <<'JSON'
{ "name": "demo", "private": true, "dependencies": { "pi-dial": "file:/c/Users/nikiforovall/dev/pi-dial" } }
JSON
(cd .pi/npm && npm install)
export DIAL_API_KEY=...
```

Then capture with one of:

- **asciinema** — `asciinema rec demo.cast` → `agg demo.cast demo.gif`
- **vhs** — write a `demo.tape` script (`Type "/dial pick"` / `Enter` / `Sleep 2s`) → `vhs demo.tape`
- **OS screen recorder** — Windows: Win+G; macOS: Cmd+Shift+5

Record the golden flow: `pi` → `/dial list` → `/dial pick` → arrow-select a
model → status bar updates → `/dial info`.

## Bundled skill

The package ships a `dial` skill (`skills/dial/SKILL.md`) declared via
`pi.skills` in `package.json`. After install, pi auto-discovers it; load it
with `/dial` (the skill name) in a session that needs to query the DIAL
catalog or rate limits via the CLI.

The skill invokes the CLI as plain `dial` — add `<pi-dial>/bin` to your
`PATH` (or symlink `bin/dial[.exe]` somewhere already on PATH) so the
shell can find it.

## Differences vs the POC

- The previous POC auto-switched models on session start (`dial-selector.ts`).
  That behavior is removed: switching is now explicit via `/dial pick`.
- All four extensions share `lib/dial-bin.ts` instead of each duplicating
  `resolveDialBinary()`.
