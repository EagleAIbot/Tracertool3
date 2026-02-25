# IPC Server

This folder contains the extracted IPC trading strategy backend code and standalone UI server.

## Contents

### Core Files
- **`ipc_ui_server.py`** - Standalone server for IPC strategy monitoring
  - Proxies Binance tick data (WebSocket)
  - Proxies Binance historical data (HTTP)
  - Reads EAI V2 API predictions from ClickHouse
  - Generates IPC trading signals
  - Broadcasts all data to UI via WebSocket

- **`ipc_strategy.py`** - IPC trading strategy logic
  - Signal generation based on prediction delta
  - Position management with trailing stops
  - Session filtering (NY 8am-11am ET)

- **`simple_test_strategy.py`** - Test strategy for UI development
  - Predictable timing and behavior
  - Simulates price movement through TSA and target
  - Useful for UI testing without live market data

- **`eai_prediction_provider.py`** - EAI V2 API prediction provider
  - Historical predictions from ClickHouse
  - Real-time prediction polling

### Configuration & Scripts
- **`requirements_ipc_ui_server.txt`** - Python dependencies
- **`test_ipc_ui_server.py`** - Test script for WebSocket and HTTP endpoints

### Documentation
- **`README_IPC_UI_Server.md`** - Complete setup and usage guide
- **`IPC_UI_Server_SETUP.md`** - Step-by-step setup instructions
- **`IPC_UI_Server_TEST_MODE.md`** - Test mode documentation
- **`EAIPredictionProvider_README.md`** - Prediction provider documentation

## Usage

### Running the Server

**Live Mode (IPC Strategy):**
```bash
python -m ipc_server.ipc_ui_server --port 8765
```

**Test Mode (Simple Test Strategy):**
```bash
python -m ipc_server.ipc_ui_server --port 8765 --test
```

### Alternative Methods

**From project root (recommended):**
```bash
python -m ipc_server.ipc_ui_server --port 8765
```

**From ipc_server directory:**
```bash
cd ipc_server
python ipc_ui_server.py --port 8765
```

**With PYTHONPATH:**
```bash
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
python -m ipc_server.ipc_ui_server --port 8765
```

## Architecture

### Purpose-Built Design
The IPC server is a **standalone, purpose-built** server with minimal dependencies:
- ✅ No complex infrastructure required
- ✅ Single-file server design
- ✅ HTTP + WebSocket only
- ✅ Clean separation from main codebase

### Integration Points
1. **Binance**: Live tick data + historical data
2. **ClickHouse**: Prediction history (read-only)
3. **UI**: WebSocket broadcast for real-time updates

### Strategy State Management
- Heartbeat broadcasts every 5 seconds
- Strategy state includes: SL, TP, TSA, ENTRY, TRAILING_STOP_ACTIVE
- Orphaned state detection (missing heartbeats)

## Dependencies

**Python:**
- `aiohttp` - HTTP server
- `websockets` - WebSocket client for Binance
- `python-dotenv` - Environment configuration
- `clickhouse-connect` - ClickHouse client

**External:**
- ClickHouse database (for prediction history)
- Binance WebSocket (real-time ticks)
- Binance REST API (historical data)

## Environment Variables

Required in `.env` file:
```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9100
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
```

## Features

### What's Included
- ✅ Real-time Binance tick proxy
- ✅ Historical data proxy (klines, aggTrades)
- ✅ EAI V2 API predictions (1h, 2h, 4h)
- ✅ IPC signal generation
- ✅ Trailing stop management
- ✅ WebSocket broadcast
- ✅ Complete UI

## Development

### Testing
```bash
# Run the test client
python ipc_server/test_ipc_ui_server.py

# Test HTTP endpoints
python ipc_server/test_ipc_ui_server.py http
```

### Test Mode
Test mode uses `Simple_Test_Strategy` which:
- Starts 5 seconds after `/api/strategy-events` is called
- Waits 5 seconds (Phase 1)
- Enters trade with SL/TSA/Target
- Simulates price movement through TSA and past target
- Updates trailing stop dynamically
- Exits after 60 seconds

Perfect for UI development without live market data!

## File Structure

```
README.md                                # This file
README_IPC_UI_Server.md                  # Complete guide
IPC_UI_Server_SETUP.md                   # Setup instructions
IPC_UI_Server_TEST_MODE.md               # Test mode docs
EAIPredictionProvider_README.md          # Provider docs
requirements_ipc_ui_server.txt           # Dependencies

ipc_server/
├── __init__.py                          # Package init
├── ipc_ui_server.py                     # Main server
├── ipc_strategy.py                      # IPC strategy logic
├── simple_test_strategy.py              # Test strategy
├── eai_prediction_provider.py           # Prediction provider
├── test_ipc_ui_server.py                # Test client
```

## See Also

- [Complete Setup Guide](README_IPC_UI_Server.md)
- [Step-by-Step Setup](IPC_UI_Server_SETUP.md)
- [Test Mode Documentation](IPC_UI_Server_TEST_MODE.md)
- [Prediction Provider Docs](EAIPredictionProvider_README.md)
