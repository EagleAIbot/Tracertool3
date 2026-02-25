# EAI Prediction Provider

Read-only provider for querying EAI predictions from ClickHouse.

## Overview

The `EAIPredictionProvider` class provides a clean interface for:
- ✅ **Standard predictions** - Query `eai_api_predictions` table directly
- ✅ **Enriched predictions** - Query predictions with Binance trade enrichment data
- ✅ **Multiple timeframes** (1h, 2h, 4h)
- ✅ **Clean abstraction** - ClickHouse details hidden from consumers
- ✅ **Stateless design** - No background tasks or API polling

## Key Features

### 1. Standard Predictions
Query predictions from `eai_api_predictions` table:
- Time range filtering
- Symbol filtering (BTC, ETH, etc.)
- Timeframe filtering (1h, 2h, 4h)
- Automatic datetime formatting to RFC3339/ISO8601

### 2. Enriched Predictions
Query predictions with Binance enrichment data:
- Includes all standard prediction fields
- Plus: actual prices, errors, percent errors
- Enrichment data joined from `binance_trades_enriched` table

### 3. Stateless Design
- No background polling or tasks
- No EAI API calls
- Just query methods that read from ClickHouse
- Predictions are populated by a separate service

### 4. Clean Interface
- Simple synchronous query methods
- Consistent datetime formatting
- No ClickHouse complexity exposed to consumers
- Easy to integrate into any application

---

## Installation

```bash
pip install clickhouse-connect pandas
```

---

## Quick Start

### Basic Usage - Standard Predictions

```python
from datetime import datetime, timedelta, UTC
from ipc_server.eai_prediction_provider import EAIPredictionProvider

# Create provider (only needs ClickHouse credentials)
provider = EAIPredictionProvider(
    clickhouse_host="localhost",
    clickhouse_port=9100,  # Native protocol port
    clickhouse_user="default",
    clickhouse_password="",
    clickhouse_database="default",
)

# Query standard predictions
end_time = datetime.now(UTC)
start_time = end_time - timedelta(hours=24)

predictions = provider.get_standard_predictions(
    start_time_str=start_time.isoformat().replace('+00:00', 'Z'),
    end_time_str=end_time.isoformat().replace('+00:00', 'Z'),
    version="V2",
    symbol="BTC",
    timeframe="2",  # 2h predictions
)

print(f"Found {len(predictions)} standard predictions")
for pred in predictions[:3]:  # Show first 3
    print(f"  {pred['prediction_time']} -> {pred['predicted_price']}")

# Close connection when done
provider.close()
```

### Basic Usage - Enriched Predictions

```python
# Query enriched predictions (includes Binance enrichment data)
enriched = provider.get_enriched_predictions(
    start_time_str=start_time.isoformat().replace('+00:00', 'Z'),
    end_time_str=end_time.isoformat().replace('+00:00', 'Z'),
    version="V2",
    symbol="BTC",
    timeframe="2",
)

print(f"Found {len(enriched)} enriched predictions")
for pred in enriched[:3]:
    print(f"  Predicted: ${pred['predicted_price']}, "
          f"Actual: ${pred.get('actual_price', 'N/A')}, "
          f"Error: {pred.get('error_percent', 'N/A')}%")
```

---

## API Reference

### Constructor

```python
EAIPredictionProvider(
    clickhouse_host: str = "localhost",
    clickhouse_port: int = 9100,
    clickhouse_user: str = "default",
    clickhouse_password: str = "",
    clickhouse_database: str = "default",
)
```

**Parameters:**
- `clickhouse_host`: ClickHouse server hostname
- `clickhouse_port`: ClickHouse native protocol port (default: 9100)
- `clickhouse_user`: ClickHouse username
- `clickhouse_password`: ClickHouse password (empty string if none)
- `clickhouse_database`: ClickHouse database name

---

### Methods

#### `get_standard_predictions()`

Query standard predictions from `eai_api_predictions` table (no enrichment).

```python
predictions = provider.get_standard_predictions(
    start_time_str: str,
    end_time_str: str,
    version: str,
    symbol: str,
    timeframe: str,
) -> list[dict[str, Any]]
```

**Parameters:**
- `start_time_str`: Start time in ISO format (e.g., '2025-10-18T19:26:27Z')
- `end_time_str`: End time in ISO format
- `version`: Prediction model version (e.g., 'V2')
- `symbol`: Trading symbol (e.g., 'BTC')
- `timeframe`: Timeframe (e.g., '1', '2', '4')

**Returns:**
List of prediction dictionaries with standard fields:
```python
{
    "id": "abc123...",
    "version": "V2",
    "symbol": "BTC",
    "hours": "2",
    "prediction_time": "2025-01-15T10:00:00.000000Z",
    "prediction_price": 95000.0,
    "predicted_time": "2025-01-15T12:00:00.000000Z",
    "predicted_price": 97000.0
}
```

**Example:**
```python
from datetime import datetime, timedelta, UTC

end_time = datetime.now(UTC)
start_time = end_time - timedelta(hours=24)

predictions = provider.get_standard_predictions(
    start_time_str=start_time.isoformat().replace('+00:00', 'Z'),
    end_time_str=end_time.isoformat().replace('+00:00', 'Z'),
    version="V2",
    symbol="BTC",
    timeframe="2"
)
```

---

#### `get_enriched_predictions()`

Query enriched predictions (standard predictions + Binance enrichment data).

```python
predictions = provider.get_enriched_predictions(
    start_time_str: str,
    end_time_str: str,
    version: str,
    symbol: str,
    timeframe: str,
) -> list[dict[str, Any]]
```

**Parameters:**
Same as `get_standard_predictions()`

**Returns:**
List of prediction dictionaries with enrichment fields:
```python
{
    # Standard fields
    "id": "abc123...",
    "version": "V2",
    "symbol": "BTC",
    "hours": "2",
    "prediction_time": "2025-01-15T10:00:00.000000Z",
    "prediction_price": 95000.0,
    "predicted_time": "2025-01-15T12:00:00.000000Z",
    "predicted_price": 97000.0,

    # Enrichment fields (from binance_trades_enriched)
    "actual_price": 96500.0,
    "error": 500.0,
    "error_percent": 0.52,
    "enriched_at": "2025-01-15T12:01:00.000000Z"
}
```

---

#### `close()`

Close ClickHouse connection.

```python
provider.close()
```

Always call this when done to properly close the ClickHouse client connection.

---

## Usage Notes

### Read-Only Design

This provider is **read-only** - it only queries existing predictions from ClickHouse:
- No EAI API calls
- No background polling tasks
- No automatic storage
- Predictions must be populated by a separate service (e.g., `prediction_service.py`)

### When to Use Standard vs Enriched Predictions

**Use `get_standard_predictions()` when:**
- You only need prediction data (no actual results)
- Lower query latency is important
- You don't need error metrics

**Use `get_enriched_predictions()` when:**
- You need to compare predictions vs actual prices
- You need error metrics (absolute error, percent error)
- You're analyzing prediction accuracy

---

## Migration from Old API

If you have code using the old `EAIPredictionProvider` with API polling:

```python
async def on_prediction(prediction_data: dict, timeframe_hours: int):
    """
    Called when new prediction arrives.

    Args:
        prediction_data: Raw EAI API response
        timeframe_hours: Prediction timeframe (1, 2, or 4)
    """
    data = prediction_data.get("data", {})

    # Extract fields
    current_price = data.get("currPrice")
    predicted_price = data.get("predictedMarketPrice")
    current_time = data.get("currenttime")  # Unix timestamp

    # Your logic here
    print(f"{timeframe_hours}h: ${current_price} → ${predicted_price}")

# Old API (no longer supported)
provider = EAIPredictionProvider(
    eai_email="...",  # REMOVED - no longer needed
    eai_password="...",  # REMOVED - no longer needed
    clickhouse_host="...",
    prediction_callback=on_prediction,  # REMOVED - no callbacks
)
```

**Callback can be:**
- Async function (`async def`)
- Sync function (`def`)
- None (no callback)

---

## ClickHouse Table Schema

The provider expects this table structure:

```sql
CREATE TABLE eai_api_predictions (
    id String,
    version String,
    symbol String,
    hours String,
    prediction_time DateTime,
    prediction_price Float64,
    predicted_time DateTime,
    predicted_price Float64,
    data String
) ENGINE = MergeTree()
ORDER BY (version, symbol, hours, prediction_time);
```

**Only this table is accessed.** No other ClickHouse functionality is exposed.

---

## Integration with IPC_UI_Server

The `IPC_UI_Server` uses `EAIPredictionProvider` for querying predictions from ClickHouse:

### Initialization
```python
# In IPC_UI_Server.start()
self.prediction_provider = EAIPredictionProvider(
    clickhouse_host=self.clickhouse_host,
    clickhouse_port=self.clickhouse_port,
    clickhouse_user=self.clickhouse_user,
    clickhouse_password=self.clickhouse_password,
    clickhouse_database=self.clickhouse_database,
)
```

### Polling for New Predictions
```python
# Background task polls every 30s
async def poll_latest_predictions(self):
    while True:
        end_time = datetime.now(UTC)
        start_time = end_time - timedelta(hours=2)

        for timeframe in [1, 2, 4]:
            predictions = await asyncio.to_thread(
                self.prediction_provider.get_standard_predictions,
                start_time.isoformat().replace('+00:00', 'Z'),
                end_time.isoformat().replace('+00:00', 'Z'),
                "V2", "BTC", str(timeframe)
            )
            if predictions:
                # Broadcast latest prediction if new
                await self.broadcast({"type": "prediction", "data": predictions[-1]})

        await asyncio.sleep(30)
```

### Historical Predictions API
```python
# GET /api/predictions?startTime=...&endTime=...&timeframe=2
async def handle_predictions(self, request):
    start_time_str = request.query["startTime"]
    end_time_str = request.query["endTime"]
    timeframe = request.query.get("timeframe", "2")

    predictions = await asyncio.to_thread(
        self.prediction_provider.get_standard_predictions,
        start_time_str, end_time_str,
        "V2", "BTC", timeframe
    )

    return web.json_response(predictions)
```

### Signal Generation
```python
# Use latest 2h prediction for IPC signal detection
async def check_signal_trigger(self, prediction, tick_data):
    if timeframe_hours == 2:
        # Store for signal generation
        self.latest_prediction = prediction_data

        # Check if signal should trigger
        await self.check_signal_trigger()
```

---

## Error Handling

The provider handles common errors gracefully:

### EAI API Errors
- **401 Unauthorized**: Automatically re-authenticates
- **Rate limits**: Retries with backoff
- **Network errors**: Logs and continues polling

### ClickHouse Errors
- **Connection errors**: Logged but don't stop polling
- **Query errors**: Logged, returns empty list
- **Insert errors**: Logged but don't affect polling

---

## Performance

### Memory Usage
- **Historical queries**: Streams results, low memory
- **In-memory cache**: Only latest prediction per timeframe (~3KB)
- **No data accumulation**: Historical data stays in ClickHouse

### Database Load
- **Inserts**: 3 predictions every 5 minutes (very light)
- **Queries**: On-demand (only when UI requests historical data)
- **No polling**: Historical data fetched on request, not polled

---

## Security Notes

### Credentials
- EAI credentials used only for API authentication
- ClickHouse credentials used only for prediction table
- No credentials stored in prediction data

### Data Access
- **Read**: Only `eai_api_predictions` table
- **Write**: Only `eai_api_predictions` table
- **No access**: Other tables, system tables, metadata

### Third-Party Exposure
When shipping to third party:
- ✅ They need ClickHouse access for historical predictions
- ✅ Provider hides all ClickHouse complexity
- ✅ Only prediction table is accessible
- ❌ No exposure of other data, schemas, or tables

---

## Testing

### Test Historical Predictions
```python
provider = EAIPredictionProvider(
    clickhouse_host="localhost",
    clickhouse_port=9100,
    clickhouse_user="default",
    clickhouse_password="",
    clickhouse_database="default",
)

# Query last hour
end = datetime.now(UTC)
start = end - timedelta(hours=1)

predictions = provider.get_standard_predictions(
    start.isoformat().replace('+00:00', 'Z'),
    end.isoformat().replace('+00:00', 'Z'),
    "V2", "BTC", "2"
)
assert len(predictions) > 0
assert predictions[0]["symbol"] == "BTC"
provider.close()
```

### Test Enriched Predictions
```python
provider = EAIPredictionProvider(
    clickhouse_host="localhost",
    clickhouse_port=9100,
    clickhouse_user="default",
    clickhouse_password="",
    clickhouse_database="default",
)

# Query enriched predictions
end = datetime.now(UTC)
start = end - timedelta(hours=24)

enriched = provider.get_enriched_predictions(
    start.isoformat().replace('+00:00', 'Z'),
    end.isoformat().replace('+00:00', 'Z'),
    "V2", "BTC", "2"
)
assert len(enriched) > 0
assert "actual_price" in enriched[0]  # Enrichment field
provider.close()
```

### Test with Empty Database
```python
provider = EAIPredictionProvider(
    clickhouse_host="localhost",
    clickhouse_port=9100,
    clickhouse_user="default",
    clickhouse_password="",
    clickhouse_database="default",
)

# Should return empty list, not error
end = datetime.now(UTC)
start = end - timedelta(hours=1)
predictions = provider.get_standard_predictions(
    start.isoformat().replace('+00:00', 'Z'),
    end.isoformat().replace('+00:00', 'Z'),
    "V2", "BTC", "2"
)
assert predictions == []
provider.close()
await asyncio.sleep(360)  # Wait for one poll cycle (6 minutes)

# Should have received 1h, 2h, and 4h predictions
assert len(received_predictions) == 3
```

---

## Troubleshooting

### No predictions received

**Check EAI credentials:**
```python
# Test login
success = await provider.login()
print(f"Login: {'OK' if success else 'FAILED'}")
```

**Check polling schedule:**
```python
# Polling happens at :05:15, :10:15, etc.
# Wait until next poll time to see results
```

### ClickHouse connection errors

**Verify connection:**
```python
from clickhouse_connect import get_client

client = get_client(host="localhost", port=8123)
result = client.query("SELECT 1")
print(f"ClickHouse: {'OK' if result else 'FAILED'}")
```

**Check table exists:**
```sql
SELECT count() FROM eai_api_predictions;
```

### Historical queries return empty

**Check time range:**
```python
# Make sure time range contains data
predictions = provider.get_standard_predictions(
    datetime(2025, 1, 1, tzinfo=UTC).isoformat().replace('+00:00', 'Z'),
    datetime(2025, 1, 15, tzinfo=UTC).isoformat().replace('+00:00', 'Z'),
    "V2", "BTC", "2"
)
```

**Check symbol/timeframe:**
```python
# Check what's in database
result = client.query("""
    SELECT DISTINCT symbol, hours, count()
    FROM eai_api_predictions
    GROUP BY symbol, hours
""")
```

---

## Example: Complete Integration

```python
import asyncio
from datetime import datetime, timedelta, UTC
from ipc_server.eai_prediction_provider import EAIPredictionProvider

class TradingBot:
    def __init__(self):
        self.prediction_provider = None
        self.latest_predictions = {}

    async def poll_predictions(self):
        """Poll for new predictions every 30s."""
        while True:
            end_time = datetime.now(UTC)
            start_time = end_time - timedelta(hours=2)

            for timeframe in [1, 2, 4]:
                predictions = await asyncio.to_thread(
                    self.prediction_provider.get_standard_predictions,
                    start_time.isoformat().replace('+00:00', 'Z'),
                    end_time.isoformat().replace('+00:00', 'Z'),
                    "V2", "BTC", str(timeframe)
                )
                if predictions:
                    latest = predictions[-1]
                    # Only process if new
                    if latest != self.latest_predictions.get(timeframe):
                        self.latest_predictions[timeframe] = latest
                        await self.on_prediction(latest, timeframe)

            await asyncio.sleep(30)

    async def on_prediction(self, data, timeframe):
        """Handle new predictions."""
        print(f"New {timeframe}h prediction: {data}")

        # Generate signal if 2h timeframe
        if timeframe == 2:
            await self.check_trading_signal(data)

    async def check_trading_signal(self, prediction_data):
        """Check if we should enter a trade."""
        data = prediction_data.get("data", {})
        current = float(data.get("currPrice", 0))
        predicted = float(str(data.get("predictedMarketPrice", "0")).replace(",", ""))

        diff = predicted - current
        if abs(diff) > 500:  # $500 threshold
            direction = "LONG" if diff > 0 else "SHORT"
            print(f"🚀 SIGNAL: {direction} @ ${current:.2f}")

    async def start(self):
        """Start the bot."""
        # Create provider
        self.prediction_provider = EAIPredictionProvider(
            clickhouse_host="localhost",
            clickhouse_port=9100,
            clickhouse_user="default",
            clickhouse_password="",
            clickhouse_database="default",
        )

        # Start polling task
        asyncio.create_task(self.poll_predictions())

        # Load historical context
        end = datetime.now(UTC)
        start = end - timedelta(hours=24)

        historical = await asyncio.to_thread(
            self.prediction_provider.get_standard_predictions,
            start.isoformat().replace('+00:00', 'Z'),
            end.isoformat().replace('+00:00', 'Z'),
            "V2", "BTC", "2"
        )

        print(f"Loaded {len(historical)} historical predictions")

        # Keep running
        await asyncio.Event().wait()

    async def stop(self):
        """Stop the bot."""
        if self.prediction_provider:
            self.prediction_provider.close()

# Run
bot = TradingBot()
try:
    asyncio.run(bot.start())
except KeyboardInterrupt:
    asyncio.run(bot.stop())
```

---

## Conclusion

`EAIPredictionProvider` provides a clean, minimal interface for prediction data:
- ✅ Historical and real-time predictions
- ✅ Automatic storage and polling
- ✅ Simple callback-based API
- ✅ ClickHouse complexity hidden
- ✅ Easy to integrate

Perfect for third-party delivery - they get prediction access without seeing your full infrastructure.
