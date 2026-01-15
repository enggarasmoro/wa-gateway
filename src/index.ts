import express, { Application, Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import messageRoutes from './routes/message.route';
import { whatsappService } from './services/whatsapp.service';
import { apiKeyAuth } from './middlewares/auth.middleware';

// Load environment variables
dotenv.config();

const app: Application = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Routes - Apply API Key auth to /api routes
app.use('/api', apiKeyAuth, messageRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    name: 'WA Gateway Service',
    version: '1.0.0',
    description: 'Self-hosted WhatsApp Gateway using Baileys',
    endpoints: {
      'POST /api/send': 'Send a single message',
      'POST /api/broadcast': 'Send message to multiple targets',
      'GET /api/health': 'Health check',
      'GET /api/status': 'Detailed status',
    },
  });
});

// Health check at root level too
app.get('/health', (req: Request, res: Response) => {
  const isConnected = whatsappService.isConnected();
  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'healthy' : 'unhealthy',
    whatsapp: isConnected ? 'connected' : 'disconnected',
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
    app.listen(PORT, HOST, () => {
      console.log('');
      console.log('='.repeat(50));
      console.log(`✅ Server running on http://${HOST}:${PORT}`);
      console.log('='.repeat(50));
      console.log('');
      console.log('Available endpoints:');
      console.log(`  POST http://${HOST}:${PORT}/api/send`);
      console.log(`  POST http://${HOST}:${PORT}/api/broadcast`);
      console.log(`  GET  http://${HOST}:${PORT}/api/health`);
      console.log(`  GET  http://${HOST}:${PORT}/api/status`);
      console.log('');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

// Start the server
startServer();
