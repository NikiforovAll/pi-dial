# dial-cli

Tiny Go CLI that talks to the DIAL `/openai/models*` endpoints. Used by the `pi-dial` extensions instead of reimplementing HTTP/auth in TypeScript.

## Build

Requires Go 1.21+.

```sh
# linux / macOS
go build -o ../bin/dial .

# windows (run in Git Bash or PowerShell from this dir)
go build -o ../bin/dial.exe .
```

Or, from the package root:

```sh
npm run build:cli
```

The binary is gitignored — every consumer builds their own. The extensions look for it at:

1. `<package-root>/bin/dial[.exe]`
2. `<package-root>/dial-cli/dial[.exe]` (dev fallback)
3. `dial`/`dial.exe` on `PATH`

## Auth

Set `DIAL_API_KEY` in your environment. The CLI fails fast if missing.

## Commands

```sh
dial models list --json
dial models <id> details --json
dial models <id> limits --json
```

These are the three calls `pi-dial` extensions make.
