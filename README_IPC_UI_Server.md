# IPC UI Server

Purpose-built, standalone server for IPC strategy monitoring.

## Features

- ✅ **Binance Tick Data** - Real-time price updates via WebSocket
- ✅ **Binance History** - Historical klines and trades data
- ✅ **EAI V2 Predictions** - Historical + Real-time predictions (1h, 2h, 4h)
  - Historical predictions from ClickHouse
  - Real-time polling 15s after every 5 minutes
  - Automatic storage of new predictions
- ✅ **IPC Signal Generation** - Live trading signals with stop loss & trailing stop
- ✅ **WebSocket Broadcast** - Real-time updates to UI
- ✅ **Simple & Clean** - Minimal infrastructure required

## Architecture

```
┌──────────────────────────────────────────────────┐
│         IPC_UI_Server (Purpose-Built)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────┐   ┌───────────────────┐     │
│  │ Binance        │   │ EAI Prediction    │     │
│  │ WebSocket      │   │ Provider          │     │
│  │ (Ticks)        │   │ ├─ EAI V2 API     │     │
│  └────────┬───────┘   │ └─ ClickHouse     │     │
│           │           │    (predictions)   │     │
│           │           └─────────┬──────────┘     │
│           │                     │                │
│           ▼                     ▼                │
│       ┌────────────────────────────┐             │
│       │      IPC Signal Logic      │             │
│       │  • Entry detection         │             │
│       │  • Stop loss               │             │
│       │  • Trailing stop           │             │
│       └──────────────┬─────────────┘             │
│                      │                           │
│                      ▼                           │
│              ┌──────────────┐                    │
│              │  WebSocket   │                    │
│              │  Broadcast   │                    │
│              └──────┬───────┘                    │
└─────────────────────┼────────────────────────────┘
                      │
                      ▼
                 ┌─────────┐
                 │   UI    │
                 │(Browser)│
                 └─────────┘
```

**Infrastructure:**
- ClickHouse: Only for prediction history (minimal access)
- No Redis ✅
- No complex message queues ✅
- Direct WebSocket communication ✅

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements_ipc_ui_server.txt
```

### 2. Configure

```bash
# Copy environment template
cp .env.template.ipc .env

# Edit .env with your credentials
nano .env
```

Add your ClickHouse credentials:
```
# ClickHouse (for reading stored predictions)
# Note: Predictions must be populated by a separate service (e.g., prediction_service.py)
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9100
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
```

**Important Notes:**
- The IPC server only **reads** predictions from ClickHouse (no EAI API calls)
- Predictions must be populated by a separate prediction service
- Use port **9100** for native protocol (not 8123 HTTP port)
- For **test mode** (`--test` flag), ClickHouse is optional:
  - Without ClickHouse: Tests strategy behavior only (no predictions on UI)
  - With ClickHouse: Tests both strategy behavior AND prediction display

### 3. Run

```bash
python -m ipc_server.ipc_ui_server --port 8765
```

Or specify custom port:
```bash
python -m ipc_server.ipc_ui_server --port 9000
```

### 4. Access

Open your browser to:
```
http://localhost:8765
```

WebSocket endpoint:
```
ws://localhost:8765/ws
```

## API Endpoints

### HTTP Endpoints

```
GET  /                     # UI homepage
GET  /js/*                 # Static JavaScript files
GET  /api/mode             # Server mode info
GET  /api/binance-klines   # Binance klines (proxy)
GET  /api/binance-aggTrades # Binance trades (proxy)
GET  /api/predictions      # Historical predictions (ClickHouse)
                          # Query params: ?startTime=...&endTime=...&timeframe=2
WS   /ws                   # WebSocket feed
```

#### Example: Get Historical Predictions
```bash
# Get 2h predictions for last 24 hours
curl "http://localhost:8765/api/predictions?startTime=2025-01-14T10:00:00Z&endTime=2025-01-15T10:00:00Z&timeframe=2"
```

Response:
```json
[
  {
    "id": "abc123...",
    "version": "V2",
    "symbol": "BTC",
    "hours": "2",
    "prediction_time": "2025-01-15T08:00:00+00:00",
    "prediction_price": 95000.0,
    "predicted_time": "2025-01-15T10:00:00+00:00",
    "predicted_price": 97000.0,
    "data": "{...}"
  }
]
```

### WebSocket Messages

The server broadcasts these message types to connected UI clients:

#### 1. Tick Data
```json
{
  "type": "trade",
  "data": {
    "e": "trade",
    "s": "BTCUSDT",
    "p": "95432.50",
    "q": "0.015",
    "T": 1234567890000
  }
}
```

#### 2. Prediction Data
```json
{
  "type": "prediction",
  "data": {
    "data": {
      "currency": "BTC",
      "currPrice": 95000,
      "predictedMarketPrice": "97500",
      "hours": 2,
      "currenttime": 1234567890
    },
    "timeframe": 2
  }
}
```

**Note:** Predictions are broadcast for all timeframes (1h, 2h, 4h) as they arrive from EAI API. The server polls 15 seconds after every 5-minute mark (:05:15, :10:15, :15:15, etc.).

#### 3. Strategy Events
```json
{
  "type": "strategy_event",
  "data": {
    "event_time": "2025-01-15T10:30:00Z",
    "position": "OPEN",
    "reason": "SIGNAL_DETECTED",
    "event_data": {
      "signal_direction": "LONG",
      "entry_price": 95000,
      "stop_loss_price": 93000,
      "predicted_price": 97000,
      "trailing_activation_price": 96000,
      "strategy_state": {
        "SL": 93000,
        "TP": 97000,
        "ENTRY": 95000,
        "TSA": 96000,
        "TRAILING_STOP_ACTIVE": false
      }
    }
  }
}
```

#### 4. Position Updates
```json
{
  "type": "strategy_event",
  "data": {
    "event_time": "2025-01-15T10:35:00Z",
    "position": "UPDATE",
    "reason": "TRAILING_STOP_ACTIVATED",
    "event_data": {
      "direction": "LONG",
      "entry_price": 95000,
      "stop_loss_price": 95100,
      "peak_price": 96000,
      "trailing_stop_activated": true,
      "current_price": 96000,
      "strategy_state": {
        "SL": 95100,
        "TP": 97000,
        "ENTRY": 95000,
        "TSA": 96000,
        "TRAILING_STOP_ACTIVE": true
      }
    }
  }
}
```

#### 5. Position Close
```json
{
  "type": "strategy_event",
  "data": {
    "event_time": "2025-01-15T10:40:00Z",
    "position": "CLOSE",
    "reason": "STOP_LOSS_HIT",
    "event_data": {
      "direction": "LONG",
      "entry_price": 95000,
      "current_price": 95100,
      "pnl": 100,
      "pnl_percentage": 0.11,
      "strategy_state": {}
    }
  }
}
```

## IPC Strategy Parameters

The server implements IPC strategy with these default parameters:

```python
delta = 500                          # Price difference threshold
initial_stop_loss_points = 2000      # Initial stop loss distance
trailing_activation_offset = 1000    # Distance to activate trailing stop
trailing_stop_distance = 900         # Trailing stop distance from peak
max_position_duration_hours = 2      # Maximum position duration
session_filter = True                # Only trade during NY session (8am-11am ET)
```

To modify parameters, edit the `__init__` method in `ipc_ui_server.py`.

## Signal Generation Logic

### Entry Conditions
1. EAI V2 prediction shows price change > $500 (delta)
2. Current time is between 8am-11am ET (if session_filter=True)
3. No active position currently open

### Position Management
- **Stop Loss**: Initial stop loss at entry ± 2000 points
- **Trailing Stop**: Activates when price moves ±1000 points in favor
  - Trails at 900 points from peak price
- **Time Limit**: Position auto-closes after 2 hours

### Exit Conditions
1. Stop loss hit
2. Trailing stop hit
3. Time limit exceeded (2 hours)

## Logging

The server logs all important events:

```
[2025-01-15 10:30:00] [INFO] Connected to Binance WebSocket
[2025-01-15 10:30:15] [INFO] Received prediction: 97500
[2025-01-15 10:30:45] [INFO] 🚀 IPC SIGNAL GENERATED: LONG @ 95000.00, SL: 93000.00, Target: 97500.00
[2025-01-15 10:35:12] [INFO] 🎯 TRAILING STOP ACTIVATED: Peak $96000.00, New SL $95100.00
[2025-01-15 10:40:30] [INFO] 🛑 STOP_LOSS_HIT: LONG position closed @ $95100.00. PNL: $100.00 (0.11%)
```

## Troubleshooting

### Server won't start

**Check Python version:**
```bash
python --version  # Needs Python 3.10+
```

**Check dependencies:**
```bash
pip install -r requirements_ipc_ui_server.txt
```

### No predictions

**Check EAI credentials:**
- Verify `.env` file exists
- Verify email and password are correct
- Check server logs for login errors

**Check EAI API status:**
- Visit https://api.eagleailabs.com
- Verify service is online

### No Binance data

**Check internet connection:**
```bash
ping api.binance.com
```

**Check firewall:**
- Ensure outbound WebSocket connections allowed
- Port 9443 for Binance WebSocket

### WebSocket not connecting

**Check browser console:**
- Open Developer Tools → Console
- Look for WebSocket errors

**Check CORS:**
- Server allows all origins
- Should work from any domain

## Development

### Project Structure

```
ipc_ui_server/
├── ipc_ui_server.py           # Main server (single file)
├── requirements_ipc_ui_server.txt  # Dependencies
├── .env.template.ipc          # Configuration template
├── .env                       # Your credentials (don't commit!)
├── README_IPC_UI_Server.md    # This file
└── UI/                        # Frontend files
    ├── chart.html
    └── js/
        ├── ChartManager.js
        ├── WebSocketManager.js
        └── ...
```

### Running in Production

For production deployment, consider using:

**systemd service:**
```ini
[Unit]
Description=IPC UI Server
After=network.target

[Service]
Type=simple
User=ipc
WorkingDirectory=/opt/ipc_ui_server
Environment=PATH=/opt/ipc_ui_server/venv/bin
ExecStart=/opt/ipc_ui_server/venv/bin/python -m ipc_server.ipc_ui_server --port 8765
Restart=always

[Install]
WantedBy=multi-user.target
```

**Docker:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements_ipc_ui_server.txt .
RUN pip install -r requirements_ipc_ui_server.txt

COPY ipc_ui_server.py .
COPY UI/ ./UI/

EXPOSE 8765

CMD ["python", "-m", "ipc_server.ipc_ui_server"]
```

**Reverse proxy (nginx):**
```nginx
server {
    listen 80;
    server_name ipc.example.com;

    location / {
        proxy_pass http://localhost:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

## Command Line Options

```bash
python -m ipc_server.ipc_ui_server --help
```

Options:
- `--port PORT` - Port to run server on (default: 8765)
- `--log-level LEVEL` - Log level (default: INFO)

## Security Notes

### Credentials
- **Never commit** `.env` file to version control
- Use environment variables in production
- Rotate passwords regularly

### Network
- Server binds to `0.0.0.0` (all interfaces)
- Use firewall to restrict access if needed
- Consider using reverse proxy with SSL/TLS

### API Rate Limits
- EAI API: Polls every 60 seconds
- Binance API: Rate limits managed by Binance
- Implement backoff if rate limited

## Performance

### Resource Usage
- **Memory**: ~50-100 MB
- **CPU**: <5% on modern hardware
- **Network**: ~10-20 KB/s steady state

### Scalability
- Supports 100+ concurrent WebSocket clients
- In-memory cache limited to 24 hours of predictions
- Single-threaded async I/O (adequate for this use case)

## License

This software is provided as-is for IPC strategy monitoring purposes.

## Support

For issues or questions:
1. Check this README
2. Check server logs
3. Verify credentials and network connectivity

## Changelog

### Version 1.0.0 (2025-01-15)
- Initial release
- Binance tick proxy
- EAI V2 API integration
- IPC signal generation
- WebSocket broadcast
- Simple, standalone architecture
