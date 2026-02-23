import express from 'express';
import { createWriteStream } from 'fs';
import { writePid, clearPid, getLogPath } from './lifecycle.js';
import { processQueue } from './processor.js';
import { getQueueDepth } from './queue.js';

const PORT = 7377;
const app = express();

let isProcessing = false;
let lastProcessed = 0;
let totalProcessed = 0;
let totalApiCalls = 0;
const startTime = Date.now();

// Redirect stdout/stderr to log file when running as daemon
if (process.env.CC_DAEMON === '1') {
  const logStream = createWriteStream(getLogPath(), { flags: 'a' });
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args: unknown[]) => {
    const msg = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
    logStream.write(msg);
    originalLog(...args);
  };

  console.error = (...args: unknown[]) => {
    const msg = `[${new Date().toISOString()}] ERROR: ${args.join(' ')}\n`;
    logStream.write(msg);
    originalError(...args);
  };
}

app.use(express.json());

app.post('/process', async (_req, res) => {
  if (isProcessing) {
    res.json({ status: 'already_processing' });
    return;
  }

  isProcessing = true;
  try {
    const stats = await processQueue();
    lastProcessed = Date.now();
    totalProcessed += stats.sessionsProcessed;
    totalApiCalls += stats.apiCallsMade;

    console.log(
      `[cc] Processed ${stats.sessionsProcessed} sessions: ` +
        `${stats.memoriesFromDecisionLog} from decision log, ` +
        `${stats.memoriesFromStructural} from structural, ` +
        `${stats.memoriesFromApi} from API (${stats.apiCallsMade} calls)`,
    );

    res.json({ status: 'ok', stats });
  } catch (error) {
    console.error('[cc] Processing failed:', error);
    res.status(500).json({ status: 'error', message: String(error) });
  } finally {
    isProcessing = false;
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    queueDepth: getQueueDepth(),
    lastProcessed,
    totalProcessed,
    totalApiCalls,
    isProcessing,
  });
});

app.post('/stop', (_req, res) => {
  res.json({ status: 'stopping' });
  clearPid();
  setTimeout(() => process.exit(0), 100);
});

// Start server
const server = app.listen(PORT, '127.0.0.1', () => {
  writePid();
  console.log(`[cc] Daemon started on port ${PORT} (pid: ${process.pid})`);
});

// Poll for pending sessions every 30 seconds
const pollInterval = setInterval(async () => {
  if (isProcessing) return;
  const depth = getQueueDepth();
  if (depth > 0) {
    isProcessing = true;
    try {
      await processQueue();
      lastProcessed = Date.now();
    } catch (error) {
      console.error('[cc] Poll processing failed:', error);
    } finally {
      isProcessing = false;
    }
  }
}, 30_000);

// Graceful shutdown
function shutdown() {
  console.log('[cc] Shutting down...');
  clearInterval(pollInterval);
  clearPid();
  server.close(() => process.exit(0));
  // Force exit after 5 seconds
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (error) => {
  console.error('[cc] Uncaught exception:', error);
  shutdown();
});
