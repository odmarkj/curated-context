import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
const CC_DIR = join(homedir(), '.curated-context');
const PID_FILE = join(CC_DIR, 'daemon.pid');
export function writePid() {
    mkdirSync(CC_DIR, { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
}
export function clearPid() {
    try {
        if (existsSync(PID_FILE)) {
            unlinkSync(PID_FILE);
        }
    }
    catch {
        // Best effort
    }
}
export function isDaemonRunning() {
    if (!existsSync(PID_FILE)) {
        return { running: false };
    }
    try {
        const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (isNaN(pid) || pid <= 0) {
            return { running: false };
        }
        // Check if process exists
        process.kill(pid, 0);
        return { running: true, pid };
    }
    catch {
        // Process doesn't exist — stale PID file
        clearPid();
        return { running: false };
    }
}
export function getLogPath() {
    return join(CC_DIR, 'daemon.log');
}
export function getDataDir() {
    return CC_DIR;
}
//# sourceMappingURL=lifecycle.js.map