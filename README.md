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
  -e API_KEY=replace-with-a-long-random-api-key \
  -e DASHBOARD_USERNAME=replace-with-dashboard-username \
  -e DASHBOARD_PASSWORD=replace-with-a-long-random-dashboard-password \
  -e JWT_SECRET=replace-with-a-different-long-random-jwt-secret \
  -e TRUST_PROXY=false \
  -v wa-auth:/app/auth \
  wa-gateway
```

### Access Dashboard

```
http://localhost:3001/
```

Login with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`. The service fails at startup if `API_KEY`, dashboard credentials, or `JWT_SECRET` are missing or still use insecure defaults.

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
| `TRUST_PROXY`        | false   | Express trust proxy setting; set to trusted proxy/CIDR or hop count only behind a reverse proxy |
| `API_KEY`            | required | API key for external access |
| `API_SEND_RATE_LIMIT_PER_MINUTE` | 30 | Per-IP send/status API request limit |
| `DASHBOARD_USERNAME` | required | Dashboard login             |
| `DASHBOARD_PASSWORD` | required | Dashboard password          |
| `JWT_SECRET`         | required | Secret for JWT tokens       |
| `DASHBOARD_BCRYPT_ROUNDS` | 12 | Dashboard password hash cost, minimum 12 |
| `MESSAGE_DELAY_MS`   | 1000    | Delay between broadcasts    |
| `AUTH_FOLDER`        | ./auth  | Session storage             |
| `WHATSAPP_INITIALIZE_RETRIES` | 2 | Retries for transient WhatsApp Web injection failures |
| `WHATSAPP_INITIALIZE_RETRY_DELAY_MS` | 5000 | Delay between initialization retries |
| `WHATSAPP_AUTH_TIMEOUT_MS` | 120000 | Max wait for whatsapp-web.js auth/injection readiness |
| `PUPPETEER_PROTOCOL_TIMEOUT_MS` | 180000 | Chrome DevTools protocol timeout for Puppeteer calls |
| `CHROME_NO_SANDBOX` | false | Add Chrome `--no-sandbox` flags only when the runtime cannot support sandboxing |
| `LOG_MESSAGE_CONTENT` | false | Store dashboard message previews; disabled redacts message content |

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
