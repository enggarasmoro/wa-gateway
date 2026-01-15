# WA Gateway Service

Self-hosted WhatsApp Gateway menggunakan [whatsapp-web.js](https://wwebjs.dev/).

## ✨ Features

- 📱 WhatsApp Web via Puppeteer
- 🔐 API Key Authentication
- 📤 Send single & broadcast messages
- ✅ Number validation before sending
- 💾 Persistent session (LocalAuth)
- 🔄 Auto-reconnect on disconnect
- 🐳 Docker ready

## 🚀 Quick Start

### Docker (Recommended)

```bash
docker build -t wa-gateway .
docker run -d \
  --name wa-gateway \
  -p 3001:3001 \
  -e API_KEY=your-api-key \
  -v wa-auth:/app/auth \
  wa-gateway

# Scan QR code
docker logs -f wa-gateway
```

### Manual

```bash
npm install
npm run build
npm start
```

## 📡 API Endpoints

### Health Check

```http
GET /health
```

### Send Message

```http
POST /api/send
X-API-Key: your-api-key
Content-Type: application/json

{
  "target": "6281234567890",
  "message": "Hello World!"
}
```

### Broadcast

```http
POST /api/broadcast
X-API-Key: your-api-key
Content-Type: application/json

{
  "targets": ["6281234567890", "6289876543210"],
  "message": "Broadcast message"
}
```

### Status

```http
GET /api/status
X-API-Key: your-api-key
```

## ⚙️ Configuration

| Variable           | Default | Description                      |
| ------------------ | ------- | -------------------------------- |
| `PORT`             | 3001    | Server port                      |
| `API_KEY`          | -       | API key for authentication       |
| `MESSAGE_DELAY_MS` | 1000    | Delay between broadcast messages |
| `AUTH_FOLDER`      | ./auth  | Session storage path             |
| `LOG_LEVEL`        | info    | Logging level (info/debug)       |

## 🔐 Authentication

All `/api/*` endpoints require `X-API-Key` header.

```bash
curl -X POST http://localhost:3001/api/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"target": "6281234567890", "message": "Test"}'
```

## 📁 Project Structure

```
wa-gateway-service/
├── src/
│   ├── index.ts                  # Express server
│   ├── services/
│   │   └── whatsapp.service.ts   # whatsapp-web.js client
│   ├── routes/
│   │   └── message.route.ts      # API routes
│   ├── middlewares/
│   │   └── auth.middleware.ts    # API key auth
│   └── types/
│       └── index.ts              # Type definitions
├── Dockerfile
├── package.json
└── tsconfig.json
```

## 📱 First-time Setup

1. Start the service
2. Check logs for QR code
3. Scan with WhatsApp

Session is persisted in `/app/auth` volume.

## ⚠️ Important Notes

- Use a **dedicated WhatsApp number**
- Keep message volume reasonable
- Server needs **768MB+ RAM** for Puppeteer/Chromium

## 📄 License

MIT
