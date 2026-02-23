import { spawn } from 'child_process';
import { join } from 'path';

export interface HookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runHook(
  hookScript: string,
  stdinData: string,
  env: Record<string, string>,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const hookPath = join(process.cwd(), 'hooks', hookScript);
    const child = spawn('node', [hookPath], {
      env: { ...process.env, ...env },
      timeout: 5000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0 }));

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}
