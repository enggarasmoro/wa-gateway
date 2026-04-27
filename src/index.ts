import 'dotenv/config';
import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { Server } from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import messageRoutes from './routes/message.route';
import dashboardRoutes from './routes/dashboard.route';
import { whatsappService } from './services/whatsapp.service';
import { apiKeyAuth } from './middlewares/auth.middleware';
import {
  createOperationContext,
  logOperationFinish,
  logOperationStart,
} from './utils/logger.util';

const app: Application = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
let server: Server | null = null;
let isShuttingDown = false;

// Trust proxy - required when behind reverse proxy (Traefik)
// for correct IP detection in rate limiting
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const headerCorrelationId = req.headers['x-correlation-id'];
  const correlationId = typeof headerCorrelationId === 'string' && headerCorrelationId.trim()
    ? headerCorrelationId.trim()
    : randomUUID();
  const context = createOperationContext(`${req.method} ${req.path}`, correlationId);

  res.locals.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);

  logOperationStart(context, {
    method: req.method,
    path: req.path,
  });

  res.on('finish', () => {
    logOperationFinish(context, res.statusCode >= 400 ? 'failure' : 'success', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      userId: res.locals.userId,
    });
  });

  next();
});

// Serve static files for dashboard
app.use(express.static(path.join(__dirname, '../public')));

// Dashboard API routes (uses JWT auth)
app.use('/api', dashboardRoutes);

// WA API routes (uses API Key auth)
app.use('/api', apiKeyAuth, messageRoutes);

// Serve dashboard at root
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check - always return 200 so Docker healthcheck passes
// WhatsApp connection status is in the response body
app.get('/health', async (req: Request, res: Response) => {
  const stateSnapshot = await whatsappService.refreshConnectionState('health');
  const isConnected = stateSnapshot.isConnected;
  const state = whatsappService.getWAState();
  res.status(200).json({
    status: 'ok',
    whatsapp: isConnected ? 'connected' : 'disconnected',
    ready: stateSnapshot.isReady,
    state,
    lastError: stateSnapshot.lastError,
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    status: 'error',
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    status: 'error',
    message: 'Internal server error',
  });
});

// Start server
async function startServer() {
  console.log('');
  console.log('='.repeat(50));
  console.log('🚀 WA Gateway Service Starting...');
  console.log('='.repeat(50));
  console.log('');

  try {
    // Initialize WhatsApp connection
    console.log('📱 Initializing WhatsApp connection...');
    await whatsappService.initialize();

    // Start Express server
    server = app.listen(PORT, HOST, () => {
      console.log('');
      console.log('='.repeat(50));
      console.log(`✅ Server running on http://${HOST}:${PORT}`);
      console.log('='.repeat(50));
      console.log('');
      console.log('Available endpoints:');
      console.log(`  📊 Dashboard: http://${HOST}:${PORT}/`);
      console.log(`  POST http://${HOST}:${PORT}/api/send`);
      console.log(`  POST http://${HOST}:${PORT}/api/broadcast`);
      console.log(`  GET  http://${HOST}:${PORT}/health`);
      console.log('');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n👋 Shutting down gracefully (${signal})...`);

  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await whatsappService.destroy();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

// Start the server
startServer();
