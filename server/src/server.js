import http from 'node:http';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import app from './app.js';
import { initRealtime } from './services/realtime.js';
import { canAccessEvent } from './services/accessService.js';

await connectDB();

const server = http.createServer(app);
initRealtime(server, { canAccessEvent });

server.listen(env.port, () => {
  console.log(`[server] Overall Tally API listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

const shutdown = (signal) => {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
