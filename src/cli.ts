import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, existsSync } from 'fs';
import { isDaemonRunning, clearPid, getDataDir } from './daemon/lifecycle.js';
import { loadStore, saveStore } from './storage/memory-store.js';
import { writeRulesFiles } from './storage/rules-writer.js';
import { writeClaudeMdSection } from './storage/claude-md.js';
import { getQueueDepth } from './daemon/queue.js';

const DAEMON_PORT = 7377;

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'start':
      await startDaemon();
      break;
    case 'stop':
      await stopDaemon();
      break;
    case 'status':
      await showStatus();
      break;
    case 'memories':
      showMemories();
      break;
    case 'forget':
      forgetMemory(process.argv[3]);
      break;
    case 'consolidate':
      await triggerConsolidate();
      break;
    default:
      printUsage();
  }
}

async function startDaemon() {
  const { running, pid } = isDaemonRunning();
  if (running) {
    console.log(`Daemon already running (pid: ${pid})`);
    return;
  }

  const detached = process.argv.includes('-d') || process.argv.includes('--detach');
  const daemonScript = join(import.meta.dirname, 'daemon', 'index.js');

  if (detached) {
    const child = spawn('node', [daemonScript], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, CC_DAEMON: '1' },
    });
    child.unref();
    console.log(`Daemon started in background (pid: ${child.pid})`);
  } else {
    console.log('Starting daemon in foreground (Ctrl+C to stop)...');
    const child = spawn('node', [daemonScript], {
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  }
}

async function stopDaemon() {
  const { running, pid } = isDaemonRunning();
  if (!running) {
    console.log('Daemon is not running');
    return;
  }

  try {
    const res = await fetch(`http://localhost:${DAEMON_PORT}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(3000),
    });

    if (res.ok) {
      console.log(`Daemon stopped (was pid: ${pid})`);
    }
  } catch {
    // Fall back to signal
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to daemon (pid: ${pid})`);
      } catch {
        console.log('Daemon process not found, clearing PID file');
        clearPid();
      }
    }
  }
}

async function showStatus() {
  const { running, pid } = isDaemonRunning();
  console.log(`Daemon: ${running ? `running (pid: ${pid})` : 'stopped'}`);
  console.log(`Pending sessions: ${getQueueDepth()}`);

  if (running) {
    try {
      const res = await fetch(`http://localhost:${DAEMON_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const health = await res.json() as Record<string, unknown>;
      console.log(`Uptime: ${health.uptime}s`);
      console.log(`Sessions processed: ${health.totalProcessed}`);
      console.log(`API calls made: ${health.totalApiCalls}`);
    } catch {
      console.log('(could not reach daemon for details)');
    }
  }

  // Show memory counts for current project
  const projectRoot = process.cwd();
  const store = loadStore(projectRoot);
  const memCount = Object.keys(store.memories).length;
  console.log(`\nProject memories: ${memCount}`);

  const globalStore = loadStore('__global__');
  const globalCount = Object.keys(globalStore.memories).length;
  console.log(`Global memories: ${globalCount}`);

  // Show API usage
  const configPath = join(getDataDir(), 'config.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const usage = config.apiUsage;
      if (usage) {
        console.log(`\nAPI calls this hour: ${usage.callsThisHour}/${10}`);
      }
    } catch {
      // Skip
    }
  }
}

function showMemories() {
  const projectRoot = process.cwd();
  const store = loadStore(projectRoot);
  const memories = Object.values(store.memories);

  if (memories.length === 0) {
    console.log('No memories stored for this project.');
    return;
  }

  // Group by category
  const grouped: Record<string, typeof memories> = {};
  for (const mem of memories) {
    if (!grouped[mem.category]) grouped[mem.category] = [];
    grouped[mem.category].push(mem);
  }

  for (const [category, mems] of Object.entries(grouped)) {
    console.log(`\n## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const mem of mems) {
      const age = Math.floor((Date.now() - mem.updatedAt) / 86400_000);
      console.log(`  ${mem.key}: ${mem.value} (${age}d ago, conf: ${mem.confidence})`);
    }
  }
}

function forgetMemory(key?: string) {
  if (!key) {
    console.log('Usage: curated-context forget <key>');
    return;
  }

  const projectRoot = process.cwd();
  const store = loadStore(projectRoot);

  if (store.memories[key]) {
    delete store.memories[key];

    saveStore(projectRoot, store);
    writeRulesFiles(projectRoot, store);
    writeClaudeMdSection(projectRoot, store);

    console.log(`Forgot: ${key}`);
  } else {
    console.log(`Memory "${key}" not found. Available keys:`);
    for (const k of Object.keys(store.memories)) {
      console.log(`  ${k}`);
    }
  }
}

async function triggerConsolidate() {
  const { running } = isDaemonRunning();
  if (!running) {
    console.log('Daemon is not running. Start it first: curated-context start');
    return;
  }

  console.log('Consolidation not yet implemented (Phase 8).');
}

function printUsage() {
  console.log(`curated-context — Intelligent memory sidecar for Claude Code

Usage:
  curated-context start [-d]    Start daemon (foreground, or -d for background)
  curated-context stop          Stop daemon
  curated-context status        Show daemon status and memory counts
  curated-context memories      List all memories for current project
  curated-context forget <key>  Remove a specific memory
  curated-context consolidate   Force memory consolidation`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
