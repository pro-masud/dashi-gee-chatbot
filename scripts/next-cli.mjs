import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';

const rawArgs = process.argv.slice(2);
const command = rawArgs[0] === 'start' ? 'start' : 'dev';
const extraArgs = rawArgs[0] === 'dev' || rawArgs[0] === 'start' ? rawArgs.slice(1) : rawArgs;

let port = process.env.PORT || '3000';
let hostname = '0.0.0.0';
const passThrough = [];

for (let i = 0; i < extraArgs.length; i++) {
  const arg = extraArgs[i];

  if (arg === '--host') {
    const next = extraArgs[i + 1];
    if (next && !next.startsWith('-')) {
      hostname = next === 'true' ? '0.0.0.0' : next;
      i += 1;
    } else {
      hostname = '0.0.0.0';
    }
    continue;
  }

  if (arg.startsWith('--host=')) {
    const val = arg.slice('--host='.length).trim();
    hostname = !val || val === 'true' ? '0.0.0.0' : val;
    continue;
  }

  if (arg === '-H' || arg === '--hostname') {
    const next = extraArgs[i + 1];
    if (next && !next.startsWith('-')) {
      hostname = next;
      i += 1;
    }
    continue;
  }

  if (arg.startsWith('--hostname=')) {
    const val = arg.slice('--hostname='.length).trim();
    if (val) hostname = val;
    continue;
  }

  if (arg === '-p' || arg === '--port') {
    const next = extraArgs[i + 1];
    if (next && !next.startsWith('-')) {
      port = next;
      i += 1;
    }
    continue;
  }

  if (arg.startsWith('--port=')) {
    const val = arg.slice('--port='.length).trim();
    if (val) port = val;
    continue;
  }

  passThrough.push(arg);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPortAvailable(targetPort, targetHost) {
  return new Promise((resolvePromise) => {
    const tester = net.createServer();
    tester.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        resolvePromise(false);
      } else {
        resolvePromise(true);
      }
    });
    tester.once('listening', () => {
      tester.close(() => resolvePromise(true));
    });
    tester.listen(Number(targetPort), targetHost);
  });
}

function getProtectedPids() {
  const protectedPids = new Set([process.pid, process.ppid]);
  if (process.platform === 'linux') {
    let cursor = process.ppid;
    for (let i = 0; i < 8 && cursor > 1; i++) {
      try {
        const stat = readFileSync(`/proc/${cursor}/stat`, 'utf8');
        const rparen = stat.lastIndexOf(')');
        if (rparen === -1) break;
        const fields = stat.slice(rparen + 2).split(' ');
        const ppid = Number(fields[1]);
        if (!Number.isInteger(ppid) || ppid <= 1 || protectedPids.has(ppid)) break;
        protectedPids.add(ppid);
        cursor = ppid;
      } catch {
        break;
      }
    }
  }
  return protectedPids;
}

function findListeningPids(targetPort, protectedPids) {
  const pids = new Set();
  const safePort = String(Number(targetPort));
  if (!/^\d+$/.test(safePort)) return [];

  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${safePort}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of out.split(/\s+/)) {
      const pid = Number(line.trim());
      if (Number.isInteger(pid) && pid > 1 && !protectedPids.has(pid)) {
        pids.add(pid);
      }
    }
  } catch {
    try {
      const out = execFileSync('ss', ['-lptn', `sport = :${safePort}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const m of out.matchAll(/pid=(\d+)/g)) {
        const pid = Number(m[1]);
        if (Number.isInteger(pid) && pid > 1 && !protectedPids.has(pid)) {
          pids.add(pid);
        }
      }
    } catch {
      // Ignore if neither lsof nor ss exists
    }
  }
  return Array.from(pids);
}

function findStaleNextPids(protectedPids) {
  const pids = new Set();
  if (process.platform === 'win32') return [];
  const cwd = process.cwd();
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,args='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const rawLine of out.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const spaceIdx = line.search(/\s/);
      if (spaceIdx === -1) continue;
      const pid = Number(line.slice(0, spaceIdx).trim());
      const cmd = line.slice(spaceIdx + 1).trim();
      if (!Number.isInteger(pid) || pid <= 1 || protectedPids.has(pid)) continue;
      const isWorkspaceNext =
        cmd.includes(`${cwd}/node_modules/next/dist/bin/next`) ||
        cmd.includes(`${cwd}/node_modules/next/dist/server/lib/start-server.js`) ||
        cmd.includes(`${cwd}/.next/dev/build/chunks/`) ||
        /^next-server\b/.test(cmd);
      if (isWorkspaceNext) {
        pids.add(pid);
      }
    }
  } catch {
    // Ignore if ps is unavailable
  }
  return Array.from(pids);
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPreviousServers(targetPort, targetHost) {
  const protectedPids = getProtectedPids();
  const portBusy = !(await isPortAvailable(targetPort, targetHost));
  const staleNextPids = command === 'dev' ? findStaleNextPids(protectedPids) : [];

  if (portBusy || staleNextPids.length > 0) {
    // Brief grace window in case previous server is finishing shutdown
    await sleep(300);
  }

  const targetPids = Array.from(
    new Set([
      ...findListeningPids(targetPort, protectedPids),
      ...(command === 'dev' ? findStaleNextPids(protectedPids) : []),
    ])
  );

  for (const pid of targetPids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore already-exited PID
    }
  }

  if (targetPids.length > 0) {
    for (let i = 0; i < 12; i++) {
      await sleep(200);
      const anyAlive = targetPids.some(isPidAlive);
      const freeNow = await isPortAvailable(targetPort, targetHost);
      if (!anyAlive && freeNow) break;
    }

    const stubbornPids = Array.from(
      new Set([
        ...targetPids.filter(isPidAlive),
        ...findListeningPids(targetPort, protectedPids),
        ...(command === 'dev' ? findStaleNextPids(protectedPids) : []),
      ])
    );
    for (const pid of stubbornPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Ignore
      }
    }
    if (stubbornPids.length > 0) {
      await sleep(250);
    }
  }

  if (command === 'dev') {
    const remainingNext = findStaleNextPids(protectedPids);
    if (remainingNext.length === 0) {
      const lockPath = resolve(process.cwd(), '.next/dev/lock');
      if (existsSync(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // Ignore lock cleanup errors
        }
      }
    }
  }
}

async function main() {
  // Prevent uncaught EPIPE errors if parent stdout/stderr disconnects during shutdown
  process.stdout?.on?.('error', () => {});
  process.stderr?.on?.('error', () => {});

  if (command === 'dev' && process.env.NODE_ENV !== 'production') {
    await cleanupPreviousServers(port, hostname);
  }

  const nextBin = resolve(process.cwd(), 'node_modules/next/dist/bin/next');
  const cmd = existsSync(nextBin) ? process.execPath : 'npx';
  const args = existsSync(nextBin)
    ? [nextBin, command, '-p', port, '-H', hostname, ...passThrough]
    : ['next', command, '-p', port, '-H', hostname, ...passThrough];

  // Keep Next.js in the same process group (detached: false) so supervisor restarts clean up the whole tree
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    env: process.env,
    detached: false,
  });

  let shuttingDown = false;

  const terminateChild = (sig) => {
    if (!child.pid || child.killed) return;
    try {
      child.kill(sig);
    } catch {
      // Ignore
    }
  };

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      terminateChild(sig);
      const forceTimer = setTimeout(() => {
        terminateChild('SIGKILL');
      }, 1500);
      forceTimer.unref();
    });
  }

  child.on('close', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
