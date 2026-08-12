/**
 * Standalone worker process for the SmartOffice command queue.
 *
 * Run with: npm run worker
 * Deploy as an always-on Node process on Render (Web Service type).
 *
 * IMPORTANT: Use DATABASE_DIRECT_URL (non-pooled) for this process.
 * pg-boss / LISTEN-NOTIFY breaks under PgBouncer transaction-pooling mode.
 */

import 'dotenv/config';
import http from 'http';
import { recoverStuckCommands, pollAndProcess } from '@/lib/queue/worker';
import { prisma } from '@/lib/prisma';

const POLL_INTERVAL_MS = 30_000; // Poll every 30 seconds
const HEALTH_CHECK_PORT = Number(process.env.WORKER_PORT ?? 3001);

let isRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function startWorker() {
  console.log('[Worker] Starting SmartOffice command queue worker...');

  await recoverStuckCommands();

  async function poll() {
    if (isRunning) return;
    isRunning = true;
    try {
      const processed = await pollAndProcess(10);
      if (processed > 0) {
        console.log(`[Worker] Processed ${processed} commands`);
      }
    } catch (err) {
      console.error('[Worker] Poll error:', err);
    } finally {
      isRunning = false;
      pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  pollTimer = setTimeout(poll, 0);
  console.log(`[Worker] Poll loop started (interval: ${POLL_INTERVAL_MS / 1000}s)`);
}

// Health check HTTP server — required for Render Web Service free tier
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Worker] Port ${HEALTH_CHECK_PORT} already in use, retrying on random port...`);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      console.log(`[Worker] Health check endpoint: http://localhost:${addr.port}/health`);
    });
  } else {
    console.error('[Worker] Health check server error:', err);
  }
});

server.listen(HEALTH_CHECK_PORT, () => {
  console.log(`[Worker] Health check endpoint: http://localhost:${HEALTH_CHECK_PORT}/health`);
});

process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down...');
  if (pollTimer) clearTimeout(pollTimer);
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] SIGINT received, shutting down...');
  if (pollTimer) clearTimeout(pollTimer);
  await prisma.$disconnect();
  server.close();
  process.exit(0);
});

startWorker().catch((err) => {
  console.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});
