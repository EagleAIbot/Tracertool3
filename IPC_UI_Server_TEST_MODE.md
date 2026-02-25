# IPC UI Server - Test Mode Documentation

## Overview

The IPC UI Server now supports two modes:
1. **Live Mode (default)**: Runs the IPC trading strategy with real predictions
2. **Test Mode**: Runs a simple test strategy for UI development and testing

## Command-Line Usage

### Run in Live Mode (IPC Strategy)
```bash
python -m ipc_server.ipc_ui_server --port 8765
```

### Run in Test Mode (Simple Test Strategy)
```bash
python -m ipc_server.ipc_ui_server --port 8765 --test
```

## Test Mode Behavior

When running with `--test` flag:

1. **Strategy Initialization**: Simple_Test_Strategy is loaded instead of IPC strategy
2. **API Trigger**: When the UI calls `/api/strategy-events` (via `fetchHistoricStrategyEvents()`), the test strategy starts after a 5-second delay
3. **Test Sequence**:
   - Wait 5 seconds after API trigger
   - Wait 5 seconds (entry delay)
   - Enter LONG trade at current market price
   - Set stop loss 2000 points below entry
   - Set target 2000 points above entry (1:1 risk/reward)
   - **Offline Simulation (enabled by default):**
     - At 10s after OPEN: Strategy appears to go offline
     - Heartbeat broadcasts completely stop (no heartbeats sent for 10s)
     - Event broadcasts are suppressed (no UPDATE events)
     - Strategy continues processing internally (trailing stops still update)
     - UI detects missing heartbeats and marks strategy as stale (lines grey out)
     - At 20s after OPEN: Strategy comes back online
     - Heartbeats and events resume with current state
   - Wait 60 seconds total (exit delay)
   - Close trade at current market price

## Strategy Files

### IPC_Strategy.py
Extracted IPC trading logic:
- Signal generation based on prediction delta
- Session filtering (NY 8am-11am ET)
- Position management with trailing stops
- Time-based position limits

### Simple_Test_Strategy.py
Simple test strategy for UI development:
- Predictable timing for testing
- No complex trailing stop logic
- Configurable entry/exit delays
- Tracks current price from ticks

## UI Integration

The test strategy:
- Broadcasts strategy events in the same format as IPC strategy
- Updates strategy lines (SL, TP, ENTRY) in real-time
- Compatible with existing UI code
- Returns "TestStrategy" in `/api/strategy_instances` endpoint

## ClickHouse and Predictions in Test Mode

Test mode is **flexible** regarding predictions:

### Without ClickHouse (Minimal Setup)
```bash
# No .env file needed
python -m ipc_server.ipc_ui_server --test
```
- ✅ Tests strategy behavior (OPEN/UPDATE/CLOSE events)
- ✅ Tests strategy lines (SL/TP/TSA)
- ✅ Tests heartbeat/staleness detection
- ❌ No predictions displayed on UI

### With ClickHouse (Full UI Testing)
```bash
# Create .env with ClickHouse credentials
echo "CLICKHOUSE_HOST=localhost" > .env
echo "CLICKHOUSE_PORT=9100" >> .env
echo "CLICKHOUSE_USER=default" >> .env
echo "CLICKHOUSE_PASSWORD=" >> .env
echo "CLICKHOUSE_DATABASE=default" >> .env

python -m ipc_server.ipc_ui_server --test
```
- ✅ Tests strategy behavior
- ✅ Tests strategy lines
- ✅ Tests heartbeat/staleness detection
- ✅ **Predictions displayed on UI** (if available in ClickHouse)

**Note:** Test strategy doesn't use predictions for signal generation, but predictions are still fetched and displayed for UI testing purposes.

## Testing Workflow

1. Start server in test mode:
   ```bash
   python -m ipc_server.ipc_ui_server --test
   ```

2. Open UI at `http://localhost:8765`

3. Load historical chart data (triggers `fetchHistoricStrategyEvents`)

4. Observe:
   - Server logs: "📡 /api/strategy-events called - triggering test strategy start"
   - Predictions appear on chart (if ClickHouse is available)
   - After 5s: Test strategy starts
   - After 10s total: Trade entry (OPEN event with strategy lines)
   - After 20s: Strategy goes offline (📴 OFFLINE MODE logged)
   - **No heartbeats sent for 10 seconds** (heartbeat loop skips broadcasting)
   - UPDATE events are suppressed (🔇 OFFLINE logged for suppressed broadcasts)
   - **UI detects missing heartbeats and greys out strategy lines**
   - After 30s: Strategy comes back online (📶 BACK ONLINE logged)
   - Heartbeats resume broadcasting with current state
   - Lines ungrey and show updated positions (trailing stops may have moved)
   - UPDATE events resume broadcasting
   - After 70s total: Trade exit (CLOSE event)

## Configuration Parameters

Test strategy parameters can be modified in `ipc_ui_server.py` `start()` method:

```python
self.strategy = SimpleTestStrategy(
    broadcast_callback=self.broadcast,
    log_callback=self.log,
    entry_delay_seconds=5,         # Delay before entering trade
    exit_delay_seconds=60,         # Duration of trade
    initial_stop_loss_points=2000, # Stop loss distance
    direction="LONG",              # LONG or SHORT
    # Offline simulation (enabled by default)
    simulate_offline=True,         # Simulate strategy going offline
    offline_start_delay=10.0,      # Seconds after OPEN to go offline
    offline_duration=10.0,         # Duration to remain offline
)
```

IPC strategy parameters:

```python
self.strategy = IPCStrategy(
    broadcast_callback=self.broadcast,
    log_callback=self.log,
    delta=500,                    # Price difference threshold
    initial_stop_loss_points=2000,
    trailing_activation_offset=1000,
    trailing_stop_distance=900,
    max_position_duration_hours=2,
    session_filter=True,          # Only trade during NY session
)
```

## Architecture

### Before (Monolithic)
```
ipc_ui_server.py
├── Signal generation logic
├── Position management logic
├── Trailing stop logic
└── Server infrastructure
```

### After (Modular)
```
ipc_ui_server.py (Server only)
├── Strategy initialization
├── Tick routing
└── WebSocket/HTTP infrastructure

IPC_Strategy.py (Production strategy)
├── Signal generation
├── Position management
└── Trailing stops

Simple_Test_Strategy.py (Test strategy)
├── Predictable sequences
└── UI testing support
```

## Benefits

1. **Separation of Concerns**: Strategy logic separated from server infrastructure
2. **Testability**: Easy to test UI with predictable test strategy
3. **Maintainability**: Strategy changes don't affect server code
4. **Extensibility**: Easy to add new strategies by implementing the same callback pattern

## Callback Pattern

Both strategies use the same callback pattern:

```python
class Strategy:
    def __init__(self, broadcast_callback, log_callback, **params):
        self.broadcast = broadcast_callback  # Async function to send events to UI
        self.log = log_callback              # Function for logging

    async def check_signal_trigger(self, prediction, tick_data):
        # Generate signals, broadcast OPEN events
        await self.broadcast({...})

    async def check_position_management(self, tick_data):
        # Manage position, broadcast UPDATE/CLOSE events
        await self.broadcast({...})
```

This allows the server to remain agnostic of strategy internals.
