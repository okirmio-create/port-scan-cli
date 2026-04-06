# port-scan-cli

Fast TCP port scanner with service names and banner grabbing.

## Install

```bash
npm install -g port-scan-cli
```

## Usage

```
port-scan-cli [host] [options]
```

`host` defaults to `127.0.0.1`.

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --ports <ports>` | Port(s) to scan | — |
| `--common` | Scan common ports preset (~35 ports) | — |
| `-t, --timeout <ms>` | Per-port timeout | `1000` |
| `-c, --concurrency <n>` | Concurrent connections | `100` |
| `--banner` | Grab banners from open ports | off |
| `--json` | Output JSON | off |

### Port formats

```bash
port-scan-cli -p 80              # single port
port-scan-cli -p 1-1024          # range
port-scan-cli -p 80,443,8080     # comma list
port-scan-cli -p 1-100,443,8080  # mixed
```

### Examples

```bash
# Scan common ports on localhost (default)
port-scan-cli

# Scan a range on a remote host
port-scan-cli 192.168.1.1 -p 1-1024

# Common ports with banner grabbing
port-scan-cli example.com --common --banner

# JSON output, 500 ms timeout
port-scan-cli 10.0.0.1 -p 1-65535 --json -t 500

# High-concurrency full scan
port-scan-cli 10.0.0.1 -p 1-65535 -c 500 -t 300
```

## Output

Open ports are shown in **green**, timed-out ports in **yellow**, closed ports are hidden.

```
  port-scan-cli scanning 35 ports on 127.0.0.1

  PORT    STATE     SERVICE              LATENCY   BANNER
  ──────────────────────────────────────────────────────────────────────
  22      open      ssh                  3ms       SSH-2.0-OpenSSH_9.6
  80      open      http                 1ms
  5432    open      postgres             2ms
  6379    open      redis                1ms       +PONG
```

## Common ports preset

21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 1433, 1521, 2049, 2375, 3000, 3306, 3389, 4200, 5000, 5173, 5432, 5900, 6379, 6443, 8080, 8443, 8888, 9000, 9090, 9092, 9200, 11211, 27017

## Build from source

```bash
npm install
npm run build
```

## License

MIT
