import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';

export interface DaemonInstance {
  process: ChildProcess;
  port: number;
  waitForReady(): Promise<void>;
  stop(): Promise<void>;
}

export async function startDaemon(env: Record<string, string>): Promise<DaemonInstance> {
  const daemonScript = join(process.cwd(), 'dist', 'daemon', 'index.js');
  const port = parseInt(env.CC_PORT || '7377', 10);

  const child = spawn('node', [daemonScript], {
    env: { ...process.env, ...env, CC_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  async function waitForReady(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (res.ok) return;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Daemon did not become ready on port ${port}`);
  }

  async function stop(): Promise<void> {
    try {
      await fetch(`http://localhost:${port}/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // fallback
    }
    child.kill('SIGTERM');
    await new Promise<void>((r) => {
      child.on('close', () => r());
      setTimeout(r, 3000);
    });
  }

  return { process: child, port, waitForReady, stop };
}
