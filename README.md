# port-scan-cli

Scan local TCP ports to find which are in use and by what process.

## Install

```bash
npm install -g port-scan-cli
```

## Usage

```bash
# Scan common development ports (default)
port-scan

# Scan a specific range
port-scan --range 3000-4000

# Scan common dev ports explicitly
port-scan --common

# Scan all ports (1-65535)
port-scan --all

# Set timeout (default: 500ms)
port-scan --range 8000-9000 --timeout 1000

# JSON output
port-scan --common --json

# Control concurrency
port-scan --all --concurrency 200
```

## Options

| Option | Description |
|---|---|
| `-r, --range <range>` | Port range to scan (e.g. `3000-4000`) |
| `-c, --common` | Scan common dev ports (80, 443, 3000, 3001, 5000, 5173, 8000, 8080, 8443, 9000) |
| `-a, --all` | Scan all ports (1-65535) |
| `-t, --timeout <ms>` | Connection timeout in milliseconds (default: 500) |
| `--json` | Output results as JSON |
| `--concurrency <n>` | Max concurrent connections (default: 100) |
| `-V, --version` | Show version |
| `-h, --help` | Show help |

## Output

The tool displays a table with:
- **PORT** — the port number
- **STATUS** — `OPEN` or `FILTERED`
- **PID** — process ID (if detectable)
- **PROCESS** — process name (if detectable)

Process detection uses `lsof` / `ss` and may require elevated privileges for full results.

## License

MIT
