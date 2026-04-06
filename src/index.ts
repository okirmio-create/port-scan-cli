import net from "node:net";
import { program } from "commander";
import chalk from "chalk";

// ─── Service names ────────────────────────────────────────────────────────────
const SERVICE_NAMES: Record<number, string> = {
  20: "ftp-data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp",
  53: "dns", 67: "dhcp", 68: "dhcp", 69: "tftp", 80: "http",
  110: "pop3", 119: "nntp", 123: "ntp", 143: "imap", 161: "snmp",
  194: "irc", 389: "ldap", 443: "https", 445: "smb", 465: "smtps",
  514: "syslog", 587: "smtp-submission", 636: "ldaps", 993: "imaps",
  995: "pop3s", 1080: "socks", 1433: "mssql", 1521: "oracle",
  2049: "nfs", 2181: "zookeeper", 2375: "docker", 2376: "docker-tls",
  3000: "node-dev", 3306: "mysql", 3389: "rdp", 4200: "angular-dev",
  4443: "https-alt", 5000: "flask/upnp", 5173: "vite", 5432: "postgres",
  5672: "amqp", 5900: "vnc", 6379: "redis", 6443: "k8s-api",
  7000: "cassandra", 7001: "cassandra-ssl", 8080: "http-proxy",
  8081: "http-alt", 8088: "hadoop", 8443: "https-alt", 8888: "jupyter",
  9000: "sonarqube", 9090: "prometheus", 9092: "kafka", 9200: "elasticsearch",
  9300: "elasticsearch-transport", 11211: "memcached", 15672: "rabbitmq-mgmt",
  27017: "mongodb", 27018: "mongodb-shard", 50000: "jenkins",
};

const COMMON_PORTS = [
  21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995,
  1433, 1521, 2049, 2375, 3000, 3306, 3389, 4200, 5000, 5173,
  5432, 5900, 6379, 6443, 8080, 8443, 8888, 9000, 9090, 9092,
  9200, 11211, 27017,
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScanResult {
  host: string;
  port: number;
  status: "open" | "closed" | "timeout";
  service: string | null;
  banner: string | null;
  latencyMs: number;
}

// ─── TCP connect probe ────────────────────────────────────────────────────────
function probePort(host: string, port: number, timeoutMs: number): Promise<ScanResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (status: ScanResult["status"]) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({
        host,
        port,
        status,
        service: SERVICE_NAMES[port] ?? null,
        banner: null,
        latencyMs: Date.now() - start,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish("open"));
    socket.on("timeout", () => finish("timeout"));
    socket.on("error", (err: NodeJS.ErrnoException) =>
      finish(err.code === "ECONNREFUSED" ? "closed" : "timeout")
    );
    socket.connect(port, host);
  });
}

// ─── Banner grabbing ──────────────────────────────────────────────────────────
function grabBanner(host: string, port: number, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let data = "";
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      socket.destroy();
      const trimmed = data.replace(/[\r\n]+$/, "").trim();
      resolve(trimmed.length > 0 ? trimmed.slice(0, 200) : null);
    };

    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("connect", () => {
      // Some services need a nudge
      socket.write("HEAD / HTTP/1.0\r\n\r\n");
      setTimeout(finish, Math.min(timeoutMs, 1500));
    });
    socket.on("timeout", finish);
    socket.on("error", finish);
    socket.connect(port, host);
  });
}

// ─── Concurrent batch runner ──────────────────────────────────────────────────
async function scanPorts(
  host: string,
  ports: number[],
  opts: { timeoutMs: number; concurrency: number; banner: boolean }
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const total = ports.length;
  let done = 0;

  const printProgress = () => {
    if (!process.stdout.isTTY) return;
    const pct = Math.round((done / total) * 100);
    const filled = Math.round(pct / 2);
    const bar = chalk.cyan("█".repeat(filled)) + chalk.gray("░".repeat(50 - filled));
    process.stdout.write(`\r  ${bar} ${chalk.white(`${pct}%`)} (${done}/${total})`);
  };

  for (let i = 0; i < ports.length; i += opts.concurrency) {
    const batch = ports.slice(i, i + opts.concurrency);
    const batchResults = await Promise.all(
      batch.map((p) => probePort(host, p, opts.timeoutMs))
    );

    for (const r of batchResults) {
      if (r.status === "open" && opts.banner) {
        r.banner = await grabBanner(host, r.port, opts.timeoutMs);
      }
      results.push(r);
    }

    done += batch.length;
    printProgress();
  }

  if (process.stdout.isTTY) {
    process.stdout.write("\r" + " ".repeat(70) + "\r");
  }

  return results;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────
function parsePortsArg(arg: string): number[] {
  // Support: "80", "1-1024", "80,443,8080", "1-100,443,8080"
  const ports = new Set<number>();
  for (const part of arg.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-").map(Number);
      if (isNaN(a) || isNaN(b) || a < 1 || b > 65535 || a > b) {
        console.error(chalk.red(`Invalid range: ${trimmed}`));
        process.exit(1);
      }
      for (let p = a; p <= b; p++) ports.add(p);
    } else {
      const n = Number(trimmed);
      if (isNaN(n) || n < 1 || n > 65535) {
        console.error(chalk.red(`Invalid port: ${trimmed}`));
        process.exit(1);
      }
      ports.add(n);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

// ─── Output formatters ────────────────────────────────────────────────────────
function printHuman(results: ScanResult[], host: string) {
  const open = results.filter((r) => r.status === "open");
  const timeout = results.filter((r) => r.status === "timeout");
  const closed = results.filter((r) => r.status === "closed");

  console.log();
  console.log(chalk.bold.white("  PORT SCAN RESULTS") + chalk.gray(` — ${host}`));
  console.log(chalk.gray("  " + "─".repeat(70)));
  console.log(
    chalk.gray(`  ${results.length} ports scanned  `) +
    chalk.green.bold(`${open.length} open`) +
    chalk.gray("  ") +
    chalk.yellow(`${timeout.length} timeout`) +
    chalk.gray("  ") +
    chalk.red(`${closed.length} closed`)
  );
  console.log(chalk.gray("  " + "─".repeat(70)));

  if (open.length === 0 && timeout.length === 0) {
    console.log(chalk.dim("  No open ports found."));
    console.log();
    return;
  }

  const header =
    "  " +
    chalk.bold("PORT".padEnd(8)) +
    chalk.bold("STATE".padEnd(10)) +
    chalk.bold("SERVICE".padEnd(20)) +
    chalk.bold("LATENCY".padEnd(10)) +
    chalk.bold("BANNER");
  console.log(header);
  console.log(chalk.gray("  " + "─".repeat(70)));

  const display = results
    .filter((r) => r.status !== "closed")
    .sort((a, b) => a.port - b.port);

  for (const r of display) {
    const portCol = chalk.white.bold(String(r.port).padEnd(8));
    const stateCol =
      r.status === "open"
        ? chalk.green.bold("open".padEnd(10))
        : chalk.yellow("timeout".padEnd(10));
    const svcCol = chalk.cyan((r.service ?? "unknown").padEnd(20));
    const latCol = chalk.dim(`${r.latencyMs}ms`.padEnd(10));
    const bannerCol = r.banner
      ? chalk.gray(r.banner.slice(0, 60).replace(/\n/g, " "))
      : "";

    console.log(`  ${portCol}${stateCol}${svcCol}${latCol}${bannerCol}`);
  }
  console.log();
}

function printJson(results: ScanResult[]) {
  const out = results.map((r) => ({
    port: r.port,
    host: r.host,
    status: r.status,
    service: r.service,
    latencyMs: r.latencyMs,
    banner: r.banner,
  }));
  console.log(JSON.stringify(out, null, 2));
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
program
  .name("port-scan-cli")
  .description("Fast TCP port scanner with service names and banner grabbing")
  .version("1.0.0")
  .argument("[host]", "target host to scan", "127.0.0.1")
  .option("-p, --ports <ports>", "port or range: 80 | 1-1024 | 80,443,8080")
  .option("--common", "scan common well-known ports (~35 ports)")
  .option("-t, --timeout <ms>", "per-port timeout in ms", "1000")
  .option("-c, --concurrency <n>", "concurrent connections", "100")
  .option("--banner", "attempt banner grabbing on open ports")
  .option("--json", "output JSON")
  .action(async (host: string, opts: {
    ports?: string;
    common?: boolean;
    timeout: string;
    concurrency: string;
    banner?: boolean;
    json?: boolean;
  }) => {
    let ports: number[];

    if (opts.ports) {
      ports = parsePortsArg(opts.ports);
    } else if (opts.common) {
      ports = [...COMMON_PORTS];
    } else {
      ports = [...COMMON_PORTS];
    }

    const timeoutMs = parseInt(opts.timeout, 10);
    const concurrency = parseInt(opts.concurrency, 10);

    if (!opts.json) {
      console.log();
      console.log(
        chalk.bold.cyan("  port-scan-cli") +
        chalk.dim(` scanning ${chalk.white(ports.length)} port${ports.length !== 1 ? "s" : ""}`) +
        chalk.dim(` on ${chalk.white(host)}`) +
        (opts.banner ? chalk.dim(" (+banner)") : "")
      );
      console.log();
    }

    const results = await scanPorts(host, ports, {
      timeoutMs,
      concurrency,
      banner: opts.banner ?? false,
    });

    if (opts.json) {
      printJson(results);
    } else {
      printHuman(results, host);
    }
  });

program.parse();
