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
/dial pick           interactive picker over all DIAL chat+tools models
/dial pick <id>      switch directly to <id>
/dial info [<id>]    full model details + per-min/per-day token limits
/dial status         force a one-shot status-bar refresh
/dial list           print every available model id
```

The picker lists every DIAL model exposing `chat_completion + tools`,
sorted by lowest day-usage first. Models over the 95% per-day or per-minute
cap are flagged with `⚠ over cap` but stay selectable.

## Bundled skill

The package ships a `dial` skill (`skills/dial/SKILL.md`) declared via
`pi.skills` in `package.json`. After install, pi auto-discovers it; load it
with `/dial` (the skill name) in a session that needs to query the DIAL
catalog or rate limits via the CLI.

The skill invokes the CLI as plain `dial`. The extension auto-prepends
`<pi-dial>/bin` to `process.env.PATH` on load, so subagents and skill
shells inherit it without manual setup.

## Differences vs the POC

- The previous POC auto-switched models on session start (`dial-selector.ts`).
  That behavior is removed: switching is now explicit via `/dial pick`.
- All four extensions share `lib/dial-bin.ts` instead of each duplicating
  `resolveDialBinary()`.
