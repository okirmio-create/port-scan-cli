import net from "node:net";
import { execSync } from "node:child_process";
import { program } from "commander";
import chalk from "chalk";

const COMMON_PORTS = [
  80, 443, 3000, 3001, 5000, 5173, 8000, 8080, 8443, 9000,
];

interface PortResult {
  port: number;
  status: "open" | "closed" | "filtered";
  process?: string;
  pid?: string;
}

function checkPort(port: number, timeout: number): Promise<PortResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const settle = (result: PortResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeout);

    socket.on("connect", () => {
      settle({ port, status: "open" });
    });

    socket.on("timeout", () => {
      settle({ port, status: "filtered" });
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED") {
        settle({ port, status: "closed" });
      } else {
        settle({ port, status: "filtered" });
      }
    });

    socket.connect(port, "127.0.0.1");
  });
}

function getProcessInfo(port: number): { process: string; pid: string } | null {
  try {
    const output = execSync(
      `lsof -i TCP:${port} -sTCP:LISTEN -n -P 2>/dev/null || ss -tlnp 'sport = :${port}' 2>/dev/null`,
      { encoding: "utf-8", timeout: 3000 }
    );

    // Parse lsof output: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const lsofLines = output.trim().split("\n");
    for (const line of lsofLines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 9 && parts[0] !== "COMMAND") {
        return { process: parts[0], pid: parts[1] };
      }
    }

    // Parse ss output fallback
    const ssMatch = output.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (ssMatch) {
      return { process: ssMatch[1], pid: ssMatch[2] };
    }
  } catch {
    // silently ignore - process detection is best-effort
  }
  return null;
}

function parseRange(range: string): number[] {
  const [startStr, endStr] = range.split("-");
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  if (isNaN(start) || isNaN(end) || start < 1 || end > 65535 || start > end) {
    console.error(chalk.red(`Invalid range: ${range}. Use format: START-END (1-65535)`));
    process.exit(1);
  }

  const ports: number[] = [];
  for (let i = start; i <= end; i++) {
    ports.push(i);
  }
  return ports;
}

async function scanPorts(
  ports: number[],
  timeout: number,
  concurrency: number
): Promise<PortResult[]> {
  const results: PortResult[] = [];
  const total = ports.length;
  let completed = 0;

  for (let i = 0; i < ports.length; i += concurrency) {
    const batch = ports.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((port) => checkPort(port, timeout))
    );

    for (const result of batchResults) {
      if (result.status === "open") {
        const info = getProcessInfo(result.port);
        if (info) {
          result.process = info.process;
          result.pid = info.pid;
        }
      }
      results.push(result);
    }

    completed += batch.length;
    if (!process.stdout.isTTY) continue;

    const pct = Math.round((completed / total) * 100);
    const bar = "█".repeat(Math.floor(pct / 2)) + "░".repeat(50 - Math.floor(pct / 2));
    process.stdout.write(`\r  ${chalk.cyan(bar)} ${chalk.white(`${pct}%`)} (${completed}/${total})`);
  }

  if (process.stdout.isTTY) {
    process.stdout.write("\r" + " ".repeat(80) + "\r");
  }

  return results;
}

function printTable(results: PortResult[]) {
  const open = results.filter((r) => r.status === "open");
  const filtered = results.filter((r) => r.status === "filtered");

  console.log();
  console.log(chalk.bold.white(`  PORT SCAN RESULTS`));
  console.log(chalk.gray(`  ${"─".repeat(60)}`));
  console.log(
    chalk.gray(`  Scanned ${results.length} ports • `) +
      chalk.green.bold(`${open.length} open`) +
      chalk.gray(` • `) +
      chalk.yellow(`${filtered.length} filtered`) +
      chalk.gray(` • `) +
      chalk.red(`${results.length - open.length - filtered.length} closed`)
  );
  console.log(chalk.gray(`  ${"─".repeat(60)}`));

  if (open.length === 0 && filtered.length === 0) {
    console.log(chalk.dim("  No open or filtered ports found."));
    console.log();
    return;
  }

  // Header
  console.log(
    chalk.bold(
      `  ${"PORT".padEnd(8)}${"STATUS".padEnd(12)}${"PID".padEnd(10)}${"PROCESS"}`
    )
  );
  console.log(chalk.gray(`  ${"─".repeat(60)}`));

  const display = results
    .filter((r) => r.status !== "closed")
    .sort((a, b) => a.port - b.port);

  for (const r of display) {
    const port = chalk.white.bold(String(r.port).padEnd(8));
    const status =
      r.status === "open"
        ? chalk.green.bold("OPEN".padEnd(12))
        : chalk.yellow("FILTERED".padEnd(12));
    const pid = chalk.dim((r.pid ?? "—").padEnd(10));
    const proc = r.process ? chalk.cyan(r.process) : chalk.dim("—");

    console.log(`  ${port}${status}${pid}${proc}`);
  }

  console.log();
}

function printJson(results: PortResult[]) {
  const output = results
    .filter((r) => r.status !== "closed")
    .map((r) => ({
      port: r.port,
      status: r.status,
      ...(r.process && { process: r.process }),
      ...(r.pid && { pid: r.pid }),
    }));
  console.log(JSON.stringify(output, null, 2));
}

program
  .name("port-scan")
  .description("Scan local TCP ports to find which are in use and by what process")
  .version("1.0.0")
  .option("-r, --range <range>", "port range to scan (e.g. 3000-4000)")
  .option("-c, --common", "scan common development ports")
  .option("-a, --all", "scan all ports (1-65535)")
  .option("-t, --timeout <ms>", "connection timeout in ms", "500")
  .option("--json", "output results as JSON")
  .option("--concurrency <n>", "max concurrent connections", "100")
  .action(async (opts) => {
    let ports: number[];

    if (opts.all) {
      ports = Array.from({ length: 65535 }, (_, i) => i + 1);
    } else if (opts.range) {
      ports = parseRange(opts.range);
    } else if (opts.common) {
      ports = [...COMMON_PORTS];
    } else {
      // Default: common ports
      ports = [...COMMON_PORTS];
    }

    const timeout = parseInt(opts.timeout, 10);
    const concurrency = parseInt(opts.concurrency, 10);

    if (!opts.json) {
      console.log();
      console.log(
        chalk.bold.cyan("  ⚡ port-scan") +
          chalk.dim(` — scanning ${ports.length} port${ports.length > 1 ? "s" : ""} on 127.0.0.1`)
      );
      console.log();
    }

    const results = await scanPorts(ports, timeout, concurrency);

    if (opts.json) {
      printJson(results);
    } else {
      printTable(results);
    }
  });

program.parse();
