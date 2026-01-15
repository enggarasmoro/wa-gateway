# WA Gateway Service

Self-hosted WhatsApp Gateway dengan Web Dashboard.

## ✨ Features

- 📱 WhatsApp Web via Puppeteer
- 🖥️ **Web Dashboard** dengan login
- 🔐 API Key Authentication
- 📤 Send single & broadcast messages
- 💾 Persistent session (LocalAuth)
- 🔄 Auto-reconnect on disconnect
- 🐳 Docker ready

## 🚀 Quick Start

### Docker

```bash
docker build -t wa-gateway .
docker run -d \
  --name wa-gateway \
  -p 3001:3001 \
  -e API_KEY=your-api-key \
  -e DASHBOARD_USERNAME=admin \
  -e DASHBOARD_PASSWORD=your-password \
  -v wa-auth:/app/auth \
  wa-gateway
```

### Access Dashboard

```
http://localhost:3001/
```

Login with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`.

## 📡 API Endpoints

### Public

- `GET /health` - Health check

### Dashboard (JWT Auth)

- `POST /api/auth/login` - Login
- `GET /api/dashboard/status` - Connection status
- `GET /api/dashboard/qr` - QR code (base64)
- `POST /api/dashboard/send` - Send message
- `POST /api/dashboard/logout` - Logout WhatsApp

### API (X-API-Key Header)

- `POST /api/send` - Send message
- `POST /api/broadcast` - Broadcast

## ⚙️ Configuration

| Variable             | Default | Description                 |
| -------------------- | ------- | --------------------------- |
| `PORT`               | 3001    | Server port                 |
| `API_KEY`            | -       | API key for external access |
| `DASHBOARD_USERNAME` | admin   | Dashboard login             |
| `DASHBOARD_PASSWORD` | -       | Dashboard password          |
| `JWT_SECRET`         | -       | Secret for JWT tokens       |
| `MESSAGE_DELAY_MS`   | 1000    | Delay between broadcasts    |
| `AUTH_FOLDER`        | ./auth  | Session storage             |

## 📁 Project Structure

```
wa-gateway-service/
├── src/
│   ├── index.ts              # Express server
│   ├── services/
│   │   ├── whatsapp.service.ts
│   │   └── auth.service.ts
│   ├── routes/
│   │   ├── message.route.ts
│   │   └── dashboard.route.ts
│   ├── middlewares/
│   │   ├── auth.middleware.ts
│   │   └── dashboard.auth.ts
│   └── public/
│       └── index.html        # Dashboard UI
├── Dockerfile
└── package.json
```

## 📄 License

MIT
