import { spawn } from 'child_process';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { isDaemonRunning, clearPid, getDataDir } from './daemon/lifecycle.js';
import { loadStore, saveStore } from './storage/memory-store.js';
import { writeRulesFiles } from './storage/rules-writer.js';
import { writeClaudeMdSection } from './storage/claude-md.js';
import { getQueueDepth } from './daemon/queue.js';
const DAEMON_PORT = 7377;
function hasFlag(flag) {
    return process.argv.includes(`--${flag}`) || process.argv.includes(`-${flag.charAt(0)}`);
}
async function main() {
    const command = process.argv[2];
    const isGlobal = hasFlag('global');
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
            showMemories(isGlobal);
            break;
        case 'forget':
            forgetMemory(getPositionalArg(3), isGlobal);
            break;
        case 'teach':
            teachMemory(process.argv[3], process.argv[4], process.argv.slice(5).join(' '), isGlobal);
            break;
        case 'search':
            searchMemories(process.argv.slice(3).join(' '));
            break;
        case 'promote':
            promoteMemory(getPositionalArg(3));
            break;
        case 'consolidate':
            await triggerConsolidate();
            break;
        default:
            printUsage();
    }
}
/** Get a positional arg, skipping flags */
function getPositionalArg(minIndex) {
    for (let i = minIndex; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (!arg.startsWith('-'))
            return arg;
    }
    return undefined;
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
    }
    else {
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
    }
    catch {
        // Fall back to signal
        if (pid) {
            try {
                process.kill(pid, 'SIGTERM');
                console.log(`Sent SIGTERM to daemon (pid: ${pid})`);
            }
            catch {
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
            const health = await res.json();
            console.log(`Uptime: ${health.uptime}s`);
            console.log(`Sessions processed: ${health.totalProcessed}`);
            console.log(`API calls made: ${health.totalApiCalls}`);
        }
        catch {
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
                console.log(`\nClaude calls this hour: ${usage.callsThisHour}/${30}`);
            }
        }
        catch {
            // Skip
        }
    }
}
function showMemories(isGlobal) {
    const storeKey = isGlobal ? '__global__' : process.cwd();
    const store = loadStore(storeKey);
    const memories = Object.values(store.memories);
    const label = isGlobal ? 'global' : 'this project';
    if (memories.length === 0) {
        console.log(`No memories stored for ${label}.`);
        return;
    }
    // Group by category
    const grouped = {};
    for (const mem of memories) {
        if (!grouped[mem.category])
            grouped[mem.category] = [];
        grouped[mem.category].push(mem);
    }
    console.log(`\n${isGlobal ? 'Global' : 'Project'} memories (${memories.length}):\n`);
    for (const [category, mems] of Object.entries(grouped)) {
        console.log(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
        for (const mem of mems) {
            const age = Math.floor((Date.now() - mem.updatedAt) / 86400_000);
            console.log(`  ${mem.key}: ${mem.value} (${age}d ago, conf: ${mem.confidence})`);
        }
    }
}
function forgetMemory(key, isGlobal) {
    if (!key) {
        console.log('Usage: curated-context forget <key> [--global]');
        return;
    }
    const storeKey = isGlobal ? '__global__' : process.cwd();
    const store = loadStore(storeKey);
    if (store.memories[key]) {
        delete store.memories[key];
        saveStore(storeKey, store);
        if (isGlobal) {
            writeRulesFiles('__global__', store);
            writeClaudeMdSection(null, store);
        }
        else {
            writeRulesFiles(storeKey, store);
            writeClaudeMdSection(storeKey, store);
        }
        console.log(`Forgot${isGlobal ? ' (global)' : ''}: ${key}`);
    }
    else {
        const label = isGlobal ? 'global' : 'project';
        console.log(`Memory "${key}" not found in ${label} store. Available keys:`);
        for (const k of Object.keys(store.memories)) {
            console.log(`  ${k}`);
        }
    }
}
function promoteMemory(key) {
    if (!key) {
        console.log('Usage: curated-context promote <key>');
        console.log('Moves a project memory to the global store.');
        return;
    }
    const projectRoot = process.cwd();
    const projectStore = loadStore(projectRoot);
    const mem = projectStore.memories[key];
    if (!mem) {
        console.log(`Memory "${key}" not found in project store. Available keys:`);
        for (const k of Object.keys(projectStore.memories)) {
            console.log(`  ${k}`);
        }
        return;
    }
    // Add to global store
    const globalStore = loadStore('__global__');
    globalStore.memories[key] = { ...mem };
    globalStore.lastUpdated = Date.now();
    saveStore('__global__', globalStore);
    writeRulesFiles('__global__', globalStore);
    writeClaudeMdSection(null, globalStore);
    // Remove from project store
    delete projectStore.memories[key];
    projectStore.lastUpdated = Date.now();
    saveStore(projectRoot, projectStore);
    writeRulesFiles(projectRoot, projectStore);
    writeClaudeMdSection(projectRoot, projectStore);
    console.log(`Promoted "${key}" from project to global store.`);
}
const VALID_CATEGORIES = ['architecture', 'design', 'api', 'conventions', 'config', 'tooling', 'gotchas'];
function teachMemory(category, key, value, isGlobal) {
    if (!category || !key || !value) {
        console.log('Usage: curated-context teach <category> <key> <value>');
        console.log(`Categories: ${VALID_CATEGORIES.join(', ')}`);
        return;
    }
    if (!VALID_CATEGORIES.includes(category)) {
        console.log(`Invalid category "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        return;
    }
    const storeKey = isGlobal ? '__global__' : process.cwd();
    const store = loadStore(storeKey);
    const existing = store.memories[key];
    const now = Date.now();
    store.memories[key] = {
        key,
        category,
        value,
        confidence: 1.0,
        source: 'manual',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        sessionId: 'manual',
    };
    store.lastUpdated = now;
    saveStore(storeKey, store);
    if (isGlobal) {
        writeRulesFiles('__global__', store);
        writeClaudeMdSection(null, store);
    }
    else {
        writeRulesFiles(storeKey, store);
        writeClaudeMdSection(storeKey, store);
    }
    const action = existing ? 'Updated' : 'Remembered';
    console.log(`${action}: ${key} → ${value} (category: ${category}${isGlobal ? ', global' : ''})`);
}
function searchMemories(query) {
    if (!query.trim()) {
        console.log('Usage: curated-context search <query>');
        return;
    }
    const q = query.toLowerCase();
    const projectStore = loadStore(process.cwd());
    const globalStore = loadStore('__global__');
    const projectMatches = Object.values(projectStore.memories).filter((m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q));
    const globalMatches = Object.values(globalStore.memories).filter((m) => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q));
    if (projectMatches.length === 0 && globalMatches.length === 0) {
        const projectCount = Object.keys(projectStore.memories).length;
        const globalCount = Object.keys(globalStore.memories).length;
        console.log(`No memories matching "${query}". Store has ${projectCount} project and ${globalCount} global memories.`);
        return;
    }
    if (projectMatches.length > 0) {
        console.log(`\nProject matches for "${query}" (${projectMatches.length}):\n`);
        const grouped = {};
        for (const m of projectMatches) {
            if (!grouped[m.category])
                grouped[m.category] = [];
            grouped[m.category].push(m);
        }
        for (const [cat, mems] of Object.entries(grouped)) {
            console.log(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
            for (const m of mems) {
                console.log(`  ${m.key}: ${m.value}`);
            }
        }
    }
    if (globalMatches.length > 0) {
        console.log(`\nGlobal matches for "${query}" (${globalMatches.length}):\n`);
        const grouped = {};
        for (const m of globalMatches) {
            if (!grouped[m.category])
                grouped[m.category] = [];
            grouped[m.category].push(m);
        }
        for (const [cat, mems] of Object.entries(grouped)) {
            console.log(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)}`);
            for (const m of mems) {
                console.log(`  ${m.key}: ${m.value}`);
            }
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
  curated-context start [-d]          Start daemon (foreground, or -d for background)
  curated-context stop                Stop daemon
  curated-context status              Show daemon status and memory counts
  curated-context memories [--global] List memories (project or global)
  curated-context forget <key> [-g]   Remove a specific memory
  curated-context teach <cat> <key> <val>  Manually add a memory
  curated-context search <query>      Search memories by keyword
  curated-context promote <key>       Move a project memory to global store
  curated-context consolidate         Force memory consolidation

Flags:
  --global, -g    Target the global memory store instead of project`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map