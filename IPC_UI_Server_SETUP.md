# IPC UI Server - Complete Setup Guide

## Prerequisites

### Required Software
1. **Python 3.10+**
   ```bash
   python --version  # Should be 3.10 or higher
   ```

2. **ClickHouse Server**
   - For historical predictions storage
   - Can be local or remote
   - Only needs access to `eai_api_predictions` table

### Required Credentials
1. **ClickHouse Access**
   - Host, port, username, password
   - Read/write access to `eai_api_predictions` table

---

## Step-by-Step Setup

### 1. Clone Repository

```bash
# Clone the repository
git clone <repository_url>
cd trading/ipc_server/

# Or if you already have the repo:
cd trading/ipc_server/
```

### 2. Install Python Dependencies

```bash
# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

**Dependencies installed:**
- `aiohttp` - HTTP server and client
- `websockets` - Binance WebSocket client
- `python-dotenv` - Environment configuration
- `clickhouse-connect` - ClickHouse client for predictions

### 3. Setup ClickHouse

**Option A: Use Existing ClickHouse Server**

If you already have a ClickHouse server:
1. Get connection details (host, port, credentials)
2. Ensure table exists (see Step 3.1 below)
3. Skip to Step 4 (Configuration)

**Option B: Install ClickHouse Locally**

```bash
# Ubuntu/Debian
curl https://clickhouse.com/ | sh
sudo ./clickhouse install
sudo clickhouse start

# macOS
brew install clickhouse
brew services start clickhouse

# Docker
docker run -d -p 8123:8123 --name clickhouse clickhouse/clickhouse-server
```

**3.1. Create Predictions Table**

Connect to ClickHouse and create the table:

```bash
# Connect to ClickHouse
clickhouse-client

# Or if remote:
clickhouse-client --host=your_host --port=9000 --user=default --password=your_password
```

Run the SQL from `clickhouse_schema_predictions.sql`:

```sql
CREATE TABLE IF NOT EXISTS eai_api_predictions (
    id String,
    version String,
    symbol String,
    hours String,
    prediction_time DateTime,
    prediction_price Float64,
    predicted_time DateTime,
    predicted_price Float64,
    data String
)
ENGINE = MergeTree()
ORDER BY (version, symbol, hours, prediction_time);
```

**Verify table created:**
```sql
SHOW TABLES;
SELECT count() FROM eai_api_predictions;
```

### 4. Configuration

```bash
# Copy environment template
cp .env.template .env

# Edit configuration
nano .env  # or use your preferred editor
```

**Configure `.env` file:**

```bash
# ClickHouse Configuration (for reading stored predictions)
# Note: Predictions are read from ClickHouse, populated by a separate service
CLICKHOUSE_HOST=localhost           # Or your ClickHouse server IP
CLICKHOUSE_PORT=9100                # Native protocol port
CLICKHOUSE_USER=default             # Your ClickHouse username
CLICKHOUSE_PASSWORD=                # Your ClickHouse password (if any)
CLICKHOUSE_DATABASE=default         # Database name

# Server Configuration (optional)
# PORT=8765
# LOG_LEVEL=INFO
```

**Important:**
- Use **native protocol port** (9100) not HTTP port (8123)
- Leave password empty if ClickHouse has no password
- Host can be IP address or hostname
- The IPC server only **reads** predictions from ClickHouse (no EAI API calls)
- Predictions must be populated by a separate prediction service
- For **test mode** (`--test` flag), ClickHouse is optional:
  - Without ClickHouse: Tests strategy behavior only
  - With ClickHouse: Tests both strategy AND predictions

### 5. Test Configuration

**Test ClickHouse Connection:**
```python
python -c "
import clickhouse_connect
import os
from dotenv import load_dotenv

load_dotenv()

client = clickhouse_connect.get_client(
    host=os.getenv('CLICKHOUSE_HOST', 'localhost'),
    port=int(os.getenv('CLICKHOUSE_PORT', '8123')),
    username=os.getenv('CLICKHOUSE_USER', 'default'),
    password=os.getenv('CLICKHOUSE_PASSWORD', ''),
)

result = client.query('SELECT 1')
print('✓ ClickHouse connected successfully')
client.close()
"
```

**Test EAI Credentials:**
```python
python -c "
import asyncio
import os
from dotenv import load_dotenv
from EAIPredictionProvider import EAIPredictionProvider

load_dotenv()

async def test():
    provider = EAIPredictionProvider(
        clickhouse_host=os.getenv('CLICKHOUSE_HOST', 'localhost'),
        clickhouse_port=int(os.getenv('CLICKHOUSE_PORT', '9100')),
        clickhouse_user=os.getenv('CLICKHOUSE_USER', 'default'),
        clickhouse_password=os.getenv('CLICKHOUSE_PASSWORD', ''),
        clickhouse_database=os.getenv('CLICKHOUSE_DATABASE', 'default'),
    )
    # Test query (fetch predictions from last 2 hours)
    from datetime import datetime, timedelta, UTC
    end_time = datetime.now(UTC)
    start_time = end_time - timedelta(hours=2)
    predictions = provider.get_standard_predictions(
        start_time.isoformat().replace('+00:00', 'Z'),
        end_time.isoformat().replace('+00:00', 'Z'),
        'V2', 'BTC', '2'
    )
    print(f'✓ ClickHouse connection successful, found {len(predictions)} predictions')
    provider.close()

asyncio.run(test())
"
```

### 6. Run the Server

**From project root (recommended):**
```bash
python -m ipc_server.ipc_ui_server --port 8765
```

**Or from ipc_server folder:**
```bash
cd ipc_server
source venv/bin/activate  # If using virtual environment
python ipc_ui_server.py --port 8765
```

**Custom port:**
```bash
python -m ipc_server.ipc_ui_server --port 9000
```

### 7. Verify Running

**Check server is running:**
```
[2025-01-15 10:30:00] [INFO] ============================================================
[2025-01-15 10:30:00] [INFO] IPC UI Server Starting
[2025-01-15 10:30:00] [INFO] ============================================================
[2025-01-15 10:30:01] [INFO] Initializing EAI Prediction Provider...
✓ EAI Prediction Provider initialized with ClickHouse connection
[2025-01-15 10:30:01] [INFO] Starting Binance tick stream...
[2025-01-15 10:30:02] [INFO] Connected to Binance WebSocket
[2025-01-15 10:30:02] [INFO] Starting prediction polling (every 30s)...
[2025-01-15 10:30:02] [INFO] ============================================================
[2025-01-15 10:30:02] [INFO] ✅ IPC UI Server running on http://0.0.0.0:8765
[2025-01-15 10:30:02] [INFO] ============================================================
```

**Open browser:**
```
http://localhost:8765
```

You should see the IPC monitoring UI.

### 8. Test WebSocket

```bash
# In another terminal
python test_ipc_ui_server.py
```

You should see real-time messages:
```
[TICK] Price: $95432.50
[PREDICTION] 2h → $97500
[SIGNAL] 🚀 LONG @ $95000.00, SL: $93000.00
```

---

## Prediction Polling Schedule

The server polls ClickHouse **every 30 seconds** for new predictions:

```
:00:00  ← POLL (fetch latest 1h, 2h, 4h predictions)
:00:30  ← POLL
:01:00  ← POLL
:01:30  ← POLL
...
```

**How it works:**
- Queries last 2 hours of predictions from ClickHouse
- Fetches all 3 timeframes in parallel (efficient)
- Only broadcasts predictions that haven't been seen before
- Predictions are assumed to be populated by a separate service

**First poll after startup:**
- Starts immediately on server start
- Broadcasts any predictions found in ClickHouse
- Continues polling every 30 seconds

---

## Troubleshooting

### Server won't start

**Check Python version:**
```bash
python --version  # Must be 3.10+
```

**Check dependencies:**
```bash
pip install -r requirements.txt
```

**Check .env file exists:**
```bash
ls -la .env
```

### No predictions received

**Check ClickHouse connection:**
```bash
# Look for initialization success in server logs
[INFO] ✓ EAI Prediction Provider initialized with ClickHouse connection
```

**Check table exists and has data:**
```bash
clickhouse-client --query "SELECT count() FROM eai_api_predictions WHERE symbol='BTC'"
```

**Check server logs for polling:**
```
[INFO] Starting prediction polling (every 30s)...
```

**Verify predictions exist in ClickHouse:**
- Predictions must be populated by a separate service
- Check if prediction service is running
- Verify predictions are being written to `eai_api_predictions` table

### Historical predictions empty

**Check time range:**
- Make sure historical data exists for requested time range
- Try wider time range

**Check table data:**
```bash
clickhouse-client --query "
  SELECT
    version, symbol, hours,
    min(prediction_time) as earliest,
    max(prediction_time) as latest,
    count() as total
  FROM eai_api_predictions
  GROUP BY version, symbol, hours
"
```

### No Binance data

**Check internet connection:**
```bash
ping api.binance.com
```

**Check WebSocket connection in logs:**
```
[INFO] Connected to Binance WebSocket
```

**Check firewall:**
- Allow outbound connections to stream.binance.com:9443

### Signals not generating

**Check predictions arrived:**
- Look for "[PREDICTION]" messages in logs
- Verify price difference > $500

**Check time window:**
- If `session_filter=True`, only generates signals 8am-11am ET
- Check current time in New York timezone

**Check active position:**
- Server only generates one signal at a time
- Must close current position before new signal

---

## Production Deployment

### Using systemd (Linux)

Create `/etc/systemd/system/ipc-ui-server.service`:

```ini
[Unit]
Description=IPC UI Server
After=network.target

[Service]
Type=simple
User=ipc
WorkingDirectory=/opt/trading
EnvironmentFile=/opt/trading/.env
ExecStart=/opt/trading/venv/bin/python -m ipc_server.ipc_ui_server --port 8765
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable ipc-ui-server
sudo systemctl start ipc-ui-server
sudo systemctl status ipc-ui-server
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY ipc_ui_server.py .
COPY EAIPredictionProvider.py .
COPY UI/ ./UI/

# Expose port
EXPOSE 8765

# Run
CMD ["python", "-m", "ipc_server.ipc_ui_server"]
```

Build and run:
```bash
docker build -t ipc-ui-server .

docker run -d \
  --name ipc-ui-server \
  -p 8765:8765 \
  -e CLICKHOUSE_HOST=host.docker.internal \
  -e CLICKHOUSE_PORT=9100 \
  -e CLICKHOUSE_USER=default \
  -e CLICKHOUSE_PASSWORD= \
  -e CLICKHOUSE_DATABASE=default \
  ipc-ui-server
```

### Using Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name ipc.yourdomain.com;

    location / {
        proxy_pass http://localhost:8765;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Timeouts
        proxy_read_timeout 86400;
    }
}
```

---

## Monitoring

### Server Health

**Check if running:**
```bash
curl http://localhost:8765/api/mode
```

Response:
```json
{
  "mode": "live",
  "simulation": false,
  "version": "IPC_UI_Server",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

### Logs

**Server logs show:**
- WebSocket connections/disconnections
- Prediction arrivals (every 5 minutes)
- Signal generation
- Stop loss hits
- Errors and warnings

**Example log output:**
```
[10:05:15] Polling predictions...
  ✓ 1h prediction received
  ✓ 2h prediction received
  ✓ 4h prediction received
[10:05:16] [INFO] Received 2h prediction: $97500
[10:05:20] [INFO] 🚀 IPC SIGNAL GENERATED: LONG @ 95000.00, SL: 93000.00, Target: 97500.00
```

### WebSocket Clients

**Check connected clients:**
Server logs show:
```
[INFO] WebSocket connected: 192.168.1.100 (total: 3)
[INFO] WebSocket disconnected: 192.168.1.100 (remaining: 2)
```

---

## Maintenance

### Update Server

```bash
# Stop server
sudo systemctl stop ipc-ui-server  # or Ctrl+C if running manually

# Pull latest changes
git pull

# Restart
sudo systemctl restart ipc-ui-server
```

### Update Dependencies

```bash
source venv/bin/activate
pip install -r requirements.txt --upgrade
```

### Clear Old Predictions

```bash
# Optional: Clear old predictions from ClickHouse
clickhouse-client --query "
  DELETE FROM eai_api_predictions
  WHERE prediction_time < now() - INTERVAL 30 DAY
"
```

### Backup Configuration

```bash
# Backup .env (contains credentials)
cp .env .env.backup

# Store securely (encrypted)
gpg -c .env.backup
```

---

## Security Best Practices

### 1. Credentials
- ✅ Never commit `.env` to version control
- ✅ Use strong passwords
- ✅ Rotate credentials regularly
- ✅ Store backups encrypted

### 2. Network
- ✅ Use firewall to restrict access
- ✅ Use reverse proxy with SSL/TLS in production
- ✅ Limit ClickHouse access to specific IP
- ✅ Use VPN if accessing over internet

### 3. ClickHouse
- ✅ Create dedicated user with limited permissions
- ✅ Only grant access to `eai_api_predictions` table
- ✅ Use read-only user if possible (for UI only)

**Create restricted ClickHouse user:**
```sql
-- Create user for IPC server
CREATE USER ipc_server IDENTIFIED BY 'strong_password';

-- Grant access only to predictions table
GRANT SELECT, INSERT ON default.eai_api_predictions TO ipc_server;

-- Use these credentials in .env
```

---

## Performance Tuning

### ClickHouse

**Add index for faster queries:**
```sql
ALTER TABLE eai_api_predictions
ADD INDEX idx_pred_time prediction_time TYPE minmax GRANULARITY 1;
```

**Optimize table:**
```sql
OPTIMIZE TABLE eai_api_predictions;
```

### Server

**Adjust log level:**
```bash
python -m ipc_server.ipc_ui_server --log-level WARNING  # Less verbose
```

**Increase worker threads (if needed):**
```python
# Not needed for current use case
# Server is single-threaded async (sufficient for 100+ clients)
```

---

## Backup and Recovery

### Backup ClickHouse Predictions

```bash
# Export predictions to file
clickhouse-client --query "
  SELECT * FROM eai_api_predictions
  FORMAT JSONEachRow
" > predictions_backup.jsonl
```

### Restore from Backup

```bash
# Import predictions from file
cat predictions_backup.jsonl | clickhouse-client --query "
  INSERT INTO eai_api_predictions FORMAT JSONEachRow
"
```

---

## Upgrading

### From Previous Version

If upgrading from a previous version:

1. **Stop server**
2. **Backup configuration**
   ```bash
   cp .env .env.backup
   ```
3. **Replace files**
   ```bash
   cp new_package/ipc_ui_server.py .
   cp new_package/EAIPredictionProvider.py .
   ```
4. **Update dependencies**
   ```bash
   pip install -r requirements.txt --upgrade
   ```
5. **Review configuration**
   - Check if new env vars added
   - Update `.env` if needed
6. **Restart server**

---

## FAQ

### Q: Do I need Redis?
**A:** No, this server doesn't use Redis.

### Q: Do I need the full ClickHouse database?
**A:** No, only the `eai_api_predictions` table is used. You can use a dedicated ClickHouse instance with just this table.

### Q: Can I use a remote ClickHouse server?
**A:** Yes, just set `CLICKHOUSE_HOST` to the remote server IP/hostname.

### Q: How much disk space does ClickHouse need?
**A:** Very little. Predictions are small (~500 bytes each). 1 year of data ≈ 50 MB.

### Q: What if ClickHouse is down?
**A:** The prediction provider will fail to initialize. Server will log a warning and continue running without prediction support. Binance data and test strategy will still work.

### Q: Can I change prediction parameters?
**A:** Yes, edit `ipc_ui_server.py` in the `__init__` method (delta, stop loss, etc.).

### Q: Can I add more timeframes?
**A:** Yes, edit `EAIPredictionProvider.py` and change `self.timeframes = [1, 2, 4]` to include more.

---

## Support

### Check Logs
```bash
# If running as service
sudo journalctl -u ipc-ui-server -f

# If running manually
# Logs appear in terminal
```

### Common Issues

1. **"Module not found"** → Install dependencies: `pip install -r requirements_ipc_ui_server.txt`
2. **"Connection refused"** → Check ClickHouse is running: `clickhouse-client --query "SELECT 1"`
3. **"No predictions"** → Check if prediction service is running and populating ClickHouse
4. **Test mode doesn't need ClickHouse** → Run with `--test` flag to bypass prediction requirements

---

## Next Steps

After successful setup:
1. ✅ Open UI in browser: `http://localhost:8765`
2. ✅ Wait for first prediction poll (up to 5 minutes)
3. ✅ Watch for IPC signals when conditions met
4. ✅ Query historical predictions using UI

For more details, see `README.md` and `EAIPredictionProvider_README.md`.
