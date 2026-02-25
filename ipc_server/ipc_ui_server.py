#!/usr/bin/env python3
# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
IPC_UI_Server - Purpose-built server for IPC strategy monitoring

A clean, standalone server that:
1. Proxies Binance tick data (WebSocket)
2. Proxies Binance historical data (HTTP)
3. Reads EAI V2 API predictions
4. Generates IPC trading signals
5. Broadcasts all data to UI via WebSocket

No complex infrastructure required - just HTTP/WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
from datetime import UTC, datetime, timedelta
from typing import Any, LiteralString
from zoneinfo import ZoneInfo

import ssl

import aiohttp
import websockets
from aiohttp import web
from dotenv import load_dotenv

# Create SSL context that doesn't verify certificates (for Mac Python SSL issues)
SSL_CONTEXT = ssl.create_default_context()
SSL_CONTEXT.check_hostname = False
SSL_CONTEXT.verify_mode = ssl.CERT_NONE

# Try to import EAIPredictionProvider, but make it optional
# (requires ClickHouse and src.Data.db.ClickHouseClient)
try:
    from ipc_server.eai_prediction_provider import EAIPredictionProvider
    HAS_PREDICTION_PROVIDER = True
except ImportError as e:
    print(f"⚠️  EAIPredictionProvider not available: {e}")
    print("   Running without prediction support (ClickHouse/src module not found)")
    EAIPredictionProvider = None  # type: ignore
    HAS_PREDICTION_PROVIDER = False

from ipc_server.ipc_strategy import IPCStrategy
from ipc_server.simple_test_strategy import SimpleTestStrategy

# Load environment variables
load_dotenv()


class IPCUIServer:
    """
    Purpose-built server for IPC strategy monitoring.

    Simple, standalone server with minimal dependencies.
    """

    def __init__(
        self,
        port: int = 8765,
        log_level: str = "INFO",
        test_mode: bool = False,
        use_standard_predictions: bool = False,
    ):
        self.port = port
        self.log_level = log_level
        self.test_mode = test_mode
        self.use_standard_predictions = use_standard_predictions
        self.app = web.Application()

        # WebSocket clients (UI connections)
        self.ws_clients: set[web.WebSocketResponse] = set()

        # In-memory state
        self.latest_tick: dict[str, Any] | None = None

        # Binance WebSocket
        self.binance_ws_task: asyncio.Task | None = None

        # EAI Prediction Provider (read-only from ClickHouse)
        self.prediction_provider: EAIPredictionProvider | None = None

        # Prediction polling task
        self.prediction_poll_task: asyncio.Task | None = None
        self.last_prediction_check: datetime | None = None

        # Track last seen predicted_time per timeframe to detect new predictions
        self.last_predicted_times: dict[int, str | None] = {1: None, 2: None, 4: None}

        # ClickHouse config (for prediction provider)
        self.clickhouse_host = os.getenv("CLICKHOUSE_HOST", "localhost")
        self.clickhouse_port = int(os.getenv("CLICKHOUSE_PORT", "9100"))  # Native protocol port
        self.clickhouse_user = os.getenv("CLICKHOUSE_USER", "default")
        self.clickhouse_password = os.getenv("CLICKHOUSE_PASSWORD", "")
        self.clickhouse_database = os.getenv("CLICKHOUSE_DATABASE", "default")

        # Strategy instance (will be initialized in start())
        self.strategy: IPCStrategy | SimpleTestStrategy | None = None
        self.heartbeat_task: asyncio.Task | None = None
        self.v23_poll_task: asyncio.Task | None = None
        self.runtime_id: str = ""  # Will be set in start()

    # ============================================
    # LOGGING
    # ============================================

    def log(self, level: str, message: str | LiteralString, **kwargs: Any) -> None:
        """Simple logging."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        extra = f" {kwargs}" if kwargs else ""
        print(f"[{timestamp}] [{level}] {message}{extra}")

    # ============================================
    # 1. BINANCE TICK PROXY
    # ============================================

    async def start_binance_tick_stream(self):
        """Connect to Binance WebSocket and relay ticks to UI."""
        uri = "wss://stream.binance.com:9443/ws/btcusdt@trade"

        while True:
            try:
                self.log("INFO", f"Connecting to Binance WebSocket: {uri}")

                async with websockets.connect(uri, ping_interval=30, ssl=SSL_CONTEXT) as ws:
                    self.log("INFO", "Connected to Binance WebSocket")

                    async for message in ws:
                        try:
                            tick_data = json.loads(message)
                            self.latest_tick = tick_data

                            # Broadcast to UI
                            await self.broadcast({"type": "trade", "data": tick_data})

                            # Forward tick to strategy
                            if self.strategy:
                                # For test strategy, track current price
                                if isinstance(self.strategy, SimpleTestStrategy):
                                    await self.strategy.process_tick(tick_data)
                                # For IPC strategy, check position management
                                elif isinstance(self.strategy, IPCStrategy):
                                    await self.strategy.check_position_management(tick_data)

                        except json.JSONDecodeError as e:
                            self.log("ERROR", f"Failed to parse Binance message: {e}")

            except Exception as e:
                self.log("ERROR", f"Binance WebSocket error: {e}")
                self.log("INFO", "Reconnecting in 5 seconds...")
                await asyncio.sleep(5)

    # ============================================
    # 2. BINANCE HISTORY PROXY
    # ============================================

    async def handle_binance_klines(self, request: web.Request) -> web.Response:
        """Proxy Binance klines API."""
        try:
            params = dict(request.query)

            connector = aiohttp.TCPConnector(ssl=SSL_CONTEXT)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    "https://api.binance.com/api/v3/klines",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return web.json_response(data)
                    else:
                        error_text = await resp.text()
                        self.log("ERROR", f"Binance API error: {resp.status} - {error_text}")
                        return web.json_response(
                            {"error": f"Binance API error: {resp.status}"}, status=resp.status
                        )

        except Exception as e:
            self.log("ERROR", f"Error proxying Binance klines: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def handle_binance_aggtrades(self, request: web.Request) -> web.Response:
        """Proxy Binance aggTrades API."""
        try:
            params = dict(request.query)

            connector = aiohttp.TCPConnector(ssl=SSL_CONTEXT)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    "https://api.binance.com/api/v3/aggTrades",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return web.json_response(data)
                    else:
                        return web.json_response(
                            {"error": f"Binance API error: {resp.status}"}, status=resp.status
                        )

        except Exception as e:
            self.log("ERROR", f"Error proxying Binance aggTrades: {e}")
            return web.json_response({"error": str(e)}, status=500)

    # ============================================
    # 3. EAI PREDICTION PROVIDER (READ-ONLY)
    # ============================================

    async def poll_latest_predictions(self):
        """Poll ClickHouse for latest predictions (every 30 seconds). Uses standard or enriched predictions based on use_standard_predictions flag."""
        while True:
            try:
                # Skip if prediction provider not available (e.g., test mode or initialization failure)
                if not self.prediction_provider:
                    await asyncio.sleep(30)
                    continue

                # Query last 2 hours for all timeframes
                end_time_dt = datetime.now(UTC)
                start_time_dt = end_time_dt - timedelta(hours=2)
                start_time_str = start_time_dt.isoformat().replace("+00:00", "Z")
                end_time_str = end_time_dt.isoformat().replace("+00:00", "Z")

                for timeframe in [1, 2, 4]:
                    try:
                        # Fetch predictions based on mode using prediction provider
                        if self.use_standard_predictions:
                            predictions = await asyncio.to_thread(
                                self.prediction_provider.get_standard_predictions,
                                start_time_str,
                                end_time_str,
                                "V2",
                                "BTC",
                                str(timeframe),
                            )
                        else:
                            # Fetch enriched predictions using prediction provider
                            predictions = await asyncio.to_thread(
                                self.prediction_provider.get_enriched_predictions,
                                start_time_str,
                                end_time_str,
                                "V2",
                                "BTC",
                                str(timeframe),
                            )

                        if predictions:
                            latest = predictions[-1]
                            predicted_time = latest.get("predicted_time")

                            # Only broadcast if new (based on predicted_time)
                            if predicted_time != self.last_predicted_times[timeframe]:
                                self.last_predicted_times[timeframe] = predicted_time

                                # Format prediction for UI (matching UI_Server.py format)
                                formatted_prediction = {
                                    "id": latest.get("id"),
                                    "prediction_time": latest.get("prediction_time"),
                                    "prediction_price": float(latest.get("prediction_price", 0.0)),
                                    "predicted_time": latest.get("predicted_time"),
                                    "predicted_price": float(latest.get("predicted_price", 0.0)),
                                    "prediction_timeframe": str(timeframe),  # String, not int
                                }

                                # Prepare broadcast data based on mode
                                if self.use_standard_predictions:
                                    # Standard predictions: no enrichment data
                                    broadcast_data = {
                                        "type": "prediction",
                                        "data": {
                                            "latest_prediction": formatted_prediction,
                                            "newly_enriched": [],  # No enrichment data available
                                        },
                                    }
                                else:
                                    # Enriched predictions: include enrichment data
                                    enriched_record = {
                                        **formatted_prediction,
                                        # Add enrichment fields (will be None if not enriched yet)
                                        "binance_trade_price_prediction": latest.get(
                                            "binance_trade_price_prediction"
                                        ),
                                        "binance_trade_price_predicted": latest.get(
                                            "binance_trade_price_predicted"
                                        ),
                                        "binance_trade_time_prediction": latest.get(
                                            "binance_trade_time_prediction"
                                        ),
                                        "binance_trade_time_predicted": latest.get(
                                            "binance_trade_time_predicted"
                                        ),
                                        "diff_at_prediction_time": latest.get("diff_at_prediction_time"),
                                        "diff_at_predicted_time": latest.get("diff_at_predicted_time"),
                                    }

                                    broadcast_data = {
                                        "type": "prediction",
                                        "data": {
                                            "latest_prediction": formatted_prediction,
                                            "newly_enriched": [enriched_record]
                                            if latest.get("binance_trade_price_predicted")
                                            else [],
                                        },
                                    }

                                # Broadcast to UI
                                await self.broadcast(broadcast_data)

                                self.log(
                                    "INFO", f"New {timeframe}h prediction: ${latest['predicted_price']:.2f}"
                                )

                                # For 2h predictions: trigger signal check immediately (IPC strategy only)
                                if (
                                    timeframe == 2
                                    and self.latest_tick
                                    and self.strategy
                                    and isinstance(self.strategy, IPCStrategy)
                                ):
                                    await self.strategy.check_signal_trigger(latest, self.latest_tick)

                    except Exception as e:
                        self.log("ERROR", f"Error fetching {timeframe}h prediction: {e}")

                self.last_prediction_check = datetime.now(UTC)

            except Exception as e:
                self.log("ERROR", f"Error in prediction polling: {e}")

            # Poll every 30 seconds
            await asyncio.sleep(30)

    async def poll_oracle_api_predictions(self):
        """Poll Oracle API for latest predictions at ~:45 seconds past every 5 minutes (giving predictions time to generate)."""
        self.log("INFO", "Starting Oracle API prediction polling (fallback mode)...")
        self.log("INFO", "Polling schedule: every 5 minutes at ~:45 seconds (00:45, 05:45, 10:45, etc.) + retry at :90")

        while True:
            try:
                # Calculate time until next 5-minute mark + 45 seconds
                # Predictions are generated at :00, :05, :10, etc. but 1h predictions can take up to 30+ seconds
                now = datetime.now(UTC)
                current_minute = now.minute
                current_second = now.second

                # Find next 5-minute boundary (0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
                minutes_past_boundary = current_minute % 5
                if minutes_past_boundary == 0 and current_second >= 45:
                    # Already past the :45 mark this cycle, wait for next one
                    seconds_until_next = (5 * 60) - current_second + 45
                elif minutes_past_boundary == 0:
                    # At a 5-minute boundary but before :45
                    seconds_until_next = 45 - current_second
                else:
                    # Between boundaries, wait until next boundary + 45 seconds
                    minutes_until_boundary = 5 - minutes_past_boundary
                    seconds_until_next = (minutes_until_boundary * 60) - current_second + 45

                # Wait until the right moment
                if seconds_until_next > 0:
                    next_poll_time = now + timedelta(seconds=seconds_until_next)
                    self.log("DEBUG", f"Next Oracle API poll at {next_poll_time.strftime('%H:%M:%S')} (in {seconds_until_next}s)")
                    await asyncio.sleep(seconds_until_next)

                # Now fetch predictions
                self.log("INFO", f"[Oracle API] Polling now at {datetime.now(UTC).strftime('%H:%M:%S')}...")
                end_time_dt = datetime.now(UTC)
                start_time_dt = end_time_dt - timedelta(hours=2)

                new_predictions_found = False
                for timeframe in [1, 2, 4]:
                    try:
                        oracle_api_url = "https://eagleoracle-production.up.railway.app/api/prediction-history"
                        params = {
                            "token": "BTC",
                            "model": "v2",
                            "timeframe": str(timeframe),
                            "startTime": start_time_dt.isoformat(),
                            "endTime": end_time_dt.isoformat(),
                        }

                        connector = aiohttp.TCPConnector(ssl=SSL_CONTEXT)
                        async with aiohttp.ClientSession(connector=connector) as session:
                            async with session.get(oracle_api_url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                                if resp.status == 200:
                                    data = await resp.json()
                                    if data.get("success") and data.get("predictions"):
                                        predictions = data["predictions"]
                                        if predictions:
                                            # Get the latest prediction
                                            latest = predictions[-1]
                                            predicted_time = datetime.fromtimestamp(latest["predictionTime"], UTC).isoformat() if latest.get("predictionTime") else None

                                            # Only broadcast if new (based on predicted_time)
                                            if predicted_time != self.last_predicted_times[timeframe]:
                                                self.last_predicted_times[timeframe] = predicted_time

                                                # Format prediction for UI
                                                formatted_prediction = {
                                                    "id": str(latest.get("predictionMadeTime", "")),
                                                    "prediction_time": datetime.fromtimestamp(latest["predictionMadeTime"], UTC).isoformat() if latest.get("predictionMadeTime") else None,
                                                    "prediction_price": float(latest.get("priceAtPrediction", 0)),
                                                    "predicted_time": predicted_time,
                                                    "predicted_price": float(latest.get("predictedPrice", 0)),
                                                    "prediction_timeframe": str(timeframe),
                                                }

                                                broadcast_data = {
                                                    "type": "prediction",
                                                    "data": {
                                                        "latest_prediction": formatted_prediction,
                                                        "newly_enriched": [],
                                                    },
                                                }

                                                # Broadcast to UI
                                                await self.broadcast(broadcast_data)
                                                new_predictions_found = True

                                                self.log(
                                                    "INFO", f"[Oracle API] New {timeframe}h prediction: ${latest['predictedPrice']:.2f}"
                                                )

                                                # For 2h predictions: trigger signal check
                                                if (
                                                    timeframe == 2
                                                    and self.latest_tick
                                                    and self.strategy
                                                    and isinstance(self.strategy, IPCStrategy)
                                                ):
                                                    await self.strategy.check_signal_trigger(formatted_prediction, self.latest_tick)

                    except Exception as e:
                        self.log("ERROR", f"Error fetching {timeframe}h prediction from Oracle API: {e}")

                if not new_predictions_found:
                    self.log("DEBUG", f"[Oracle API] No new predictions detected (same timestamps as before)")

            except Exception as e:
                self.log("ERROR", f"Error in Oracle API prediction polling: {e}")
                import traceback
                self.log("ERROR", f"Traceback: {traceback.format_exc()}")
                # On error, wait 30 seconds before retrying
                await asyncio.sleep(30)

    async def handle_predictions(self, request: web.Request) -> web.Response:
        """Get historical predictions. Proxies to Oracle predictions API."""
        try:
            # Get query parameters
            start_time_str = request.query.get("startTime")
            end_time_str = request.query.get("endTime")
            timeframe = request.query.get("timeframe", "1")
            version = request.query.get("version", "V2")
            symbol = request.query.get("symbol", "BTC")

            # Map version format (V2 -> v2)
            model = version.lower() if version else "v2"

            # Default time range: last 24 hours
            if not end_time_str:
                end_time_str = datetime.now(UTC).isoformat()
            if not start_time_str:
                start_time_str = (datetime.now(UTC) - timedelta(hours=24)).isoformat()

            # Proxy to Oracle predictions API (Railway deployment)
            oracle_api_url = "https://eagleoracle-production.up.railway.app/api/prediction-history"
            params = {
                "token": symbol,
                "model": model,
                "timeframe": timeframe,
                "startTime": start_time_str,
                "endTime": end_time_str,
            }

            connector = aiohttp.TCPConnector(ssl=SSL_CONTEXT)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(oracle_api_url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Transform to Tracer Tool format
                        if data.get("success") and data.get("predictions"):
                            predictions = []
                            for p in data["predictions"]:
                                predictions.append({
                                    "id": str(p.get("predictionMadeTime", "")),
                                    "prediction_time": datetime.fromtimestamp(p["predictionMadeTime"], UTC).isoformat() if p.get("predictionMadeTime") else None,
                                    "prediction_price": p.get("priceAtPrediction", 0),
                                    "predicted_time": datetime.fromtimestamp(p["predictionTime"], UTC).isoformat() if p.get("predictionTime") else None,
                                    "predicted_price": p.get("predictedPrice", 0),
                                    "version": version,
                                    "symbol": symbol,
                                    "hours": timeframe,
                                })
                            return web.json_response(predictions)
                        return web.json_response([])
                    else:
                        self.log("ERROR", f"Oracle API error: {resp.status}")
                        return web.json_response({"error": f"Oracle API error: {resp.status}"}, status=resp.status)

        except Exception as e:
            self.log("ERROR", f"Error getting predictions: {e}")
            return web.json_response({"error": str(e)}, status=500)

    async def handle_backtest_trades(self, request: web.Request) -> web.Response:
        """
        Get historical trades from Oracle's IPC Strategy Playbook.
        This returns the EXACT trades that BacktestHub calculated - 100% match, no re-computation.
        """
        try:
            # Get strategy params from query
            direction = request.query.get("direction", "ANY").upper()
            delta_min = float(request.query.get("delta", "0"))
            indicator = request.query.get("indicator", "ANY").upper()
            session = request.query.get("session", "ANY").upper()
            timeframe = request.query.get("timeframe", "1")
            days_back = int(request.query.get("days", "14"))
            trades_per_day = int(request.query.get("tradesPerDay", "1"))

            self.log("INFO", f"Backtest trades request: dir={direction}, delta>={delta_min}, ind={indicator}, sess={session}, tf={timeframe}, trades/day={trades_per_day}")

            # Map session to hours array for Oracle API
            session_hours_map = {
                "IPC_MORNING": [8, 9, 10],      # 8am-11am NYC
                "LATE_MORNING": [9, 10, 11],   # 9am-12pm NYC
                "AFTERNOON": [13, 14, 15],     # 1pm-4pm NYC
                "FULL_DAY": [8, 9, 10, 11, 12, 13, 14, 15],  # 8am-4pm NYC
                "ANY": None,                    # All hours
            }
            session_hours = session_hours_map.get(session)
            session_label_map = {
                "IPC_MORNING": "IPC Morning (8-11 NYC)",
                "LATE_MORNING": "Late Morning (9-12 NYC)",
                "AFTERNOON": "Afternoon (1-4 NYC)",
                "FULL_DAY": "Full Day (8-4 NYC)",
                "ANY": "Any Time",
            }

            # Map indicator to Oracle format
            indicator_map = {
                "MACD_BULL": {"type": "macdBull", "label": "MACD Bull"},
                "MACD_BEAR": {"type": "macdBear", "label": "MACD Bear"},
                "EMA_BULL": {"type": "emaBull", "label": "EMA Bull"},
                "EMA_BEAR": {"type": "emaBear", "label": "EMA Bear"},
                "RSI_OVERSOLD": {"type": "rsiOversold", "label": "RSI < 40"},
                "RSI_OVERBOUGHT": {"type": "rsiOverbought", "label": "RSI > 60"},
                "ADX_STRONG": {"type": "adx", "threshold": 25, "label": "ADX > 25"},
                "ANY": None,
                "NONE": None,
            }
            indicator_obj = indicator_map.get(indicator)

            # Build request body for Oracle's IPC Strategy Playbook
            end_time = datetime.now(UTC)
            start_time = end_time - timedelta(days=days_back)

            playbook_body = {
                "horizons": [int(timeframe)],
                "direction": direction if direction != "ANY" else "LONG",  # Playbook requires direction
                "deltaMin": int(delta_min),
                "deltaMax": 100000,
                "session": {"hours": session_hours, "label": session_label_map.get(session, "Any Time")} if session_hours else None,
                "indicator": indicator_obj,
                "contractType": "MBT",
                "numContracts": 40,
                "model": "v2",
                "dateFrom": start_time.strftime("%Y-%m-%d"),
                "dateTo": end_time.strftime("%Y-%m-%d"),
                "tradesPerDay": trades_per_day
            }

            # Call Oracle's IPC Strategy Playbook - returns EXACT trades from BacktestHub
            oracle_api_url = "https://eagleoracle-production.up.railway.app/api/backtest/ipc-strategy-playbook"

            connector = aiohttp.TCPConnector(ssl=SSL_CONTEXT)
            async with aiohttp.ClientSession(connector=connector) as http_session:
                async with http_session.post(
                    oracle_api_url,
                    json=playbook_body,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        self.log("ERROR", f"Oracle Playbook API error: {resp.status} - {error_text[:200]}")
                        return web.json_response({"error": f"Oracle API error: {resp.status}"}, status=resp.status)
                    data = await resp.json()

            if not data.get("success") or not data.get("data"):
                self.log("WARNING", f"Oracle Playbook returned no data: {data}")
                return web.json_response({"trades": [], "stats": {}})

            playbook_data = data["data"]
            oracle_trades = playbook_data.get("trades", [])
            oracle_stats = playbook_data.get("stats", {})

            # Convert Oracle trades to Tracer format
            trades = []
            nyc_tz = ZoneInfo("America/New_York")

            for t in oracle_trades:
                # Parse date and time to create timestamps
                date_str = t.get("date", "")
                time_nyc = t.get("timeNYC", "00:00")

                # Create NYC datetime and convert to UTC timestamp
                try:
                    nyc_dt = datetime.strptime(f"{date_str} {time_nyc}", "%Y-%m-%d %H:%M")
                    nyc_dt = nyc_dt.replace(tzinfo=nyc_tz)
                    entry_timestamp = int(nyc_dt.timestamp())
                    # Exit time is entry + horizon hours
                    exit_timestamp = entry_timestamp + (int(timeframe) * 3600)
                except:
                    entry_timestamp = 0
                    exit_timestamp = 0

                # Calculate PnL percentage from entry/exit prices
                entry_price = t.get("entry", 0)
                exit_price = t.get("exit", 0)
                direction = t.get("direction", "LONG")
                if entry_price and entry_price != 0:
                    if direction == "LONG":
                        pnl_percent = ((exit_price - entry_price) / entry_price) * 100
                    else:  # SHORT
                        pnl_percent = ((entry_price - exit_price) / entry_price) * 100
                else:
                    pnl_percent = 0

                trade = {
                    "id": t.get("id", len(trades) + 1),
                    "direction": direction,
                    "entryTime": entry_timestamp,
                    "entryTimeISO": nyc_dt.astimezone(UTC).isoformat() if entry_timestamp else None,
                    "exitTime": exit_timestamp,
                    "exitTimeISO": datetime.fromtimestamp(exit_timestamp, UTC).isoformat() if exit_timestamp else None,
                    "entryPrice": entry_price,
                    "exitPrice": exit_price,
                    "predictedPrice": t.get("target", 0),
                    "delta": t.get("dollarMove", 0),
                    "pnl": t.get("profitPerContract", 0),  # Dollar PnL per contract
                    "pnlPercent": round(pnl_percent, 2),   # Percentage PnL
                    "pnlTotal": t.get("profitTotal", 0),   # Total PnL with contracts
                    "result": t.get("result", "LOSS"),
                    "indicators": t.get("indicators", {}),
                    "timeNYC": time_nyc,
                }
                trades.append(trade)

            # Calculate total percentage P&L (sum of all trade percentages)
            total_pnl_percent = sum(t.get("pnlPercent", 0) for t in trades)

            # Use Oracle's stats directly
            stats = {
                "totalTrades": int(oracle_stats.get("totalTrades", 0)),
                "wins": int(oracle_stats.get("wins", 0)),
                "losses": int(oracle_stats.get("losses", 0)),
                "winRate": float(oracle_stats.get("winRate", 0)),
                "totalPnL": float(oracle_stats.get("totalPnLMulti", 0)),  # Use multi-contract PnL (for IPC mode)
                "totalPnLPercent": round(total_pnl_percent, 2),  # Percentage-based total (for default mode)
                "avgPnL": float(oracle_stats.get("avgDailyPnLMulti", 0)),
                "tradingDays": int(oracle_stats.get("tradingDays", 0)),
            }

            self.log("INFO", f"Playbook returned: {stats['totalTrades']} trades, {stats['winRate']}% win rate, ${stats['totalPnL']} total PnL")

            return web.json_response({
                "trades": trades,
                "stats": stats,
                "strategy": playbook_data.get("strategy", {}),
                "dateRange": playbook_data.get("dateRange", {}),
            })

        except Exception as e:
            self.log("ERROR", f"Error in backtest trades: {e}")
            import traceback
            traceback.print_exc()
            return web.json_response({"error": str(e)}, status=500)

    # ============================================
    # 4. WEBSOCKET BROADCAST
    # ============================================

    async def broadcast(self, message: dict[str, Any]):
        """Broadcast message to all connected UI clients."""
        if not self.ws_clients:
            return

        try:
            message_str = json.dumps(message)

            # Send to all clients
            disconnected = set()
            for ws in self.ws_clients:
                try:
                    await ws.send_str(message_str)
                except Exception:
                    disconnected.add(ws)

            # Clean up disconnected clients
            self.ws_clients -= disconnected

        except Exception as e:
            self.log("ERROR", f"Error broadcasting: {e}")


    async def poll_v23_predictions(self) -> None:
        """Poll v2.3 shadow predictions from validator API every 30 seconds and broadcast to UI."""
        VALIDATOR_URL = "http://127.0.0.1:8790/api/v23/feed?limit=5&days=1"
        last_timestamp = None

        self.log("INFO", "v2.3 prediction polling started (every 30s)")
        while True:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(VALIDATOR_URL, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            predictions = data.get("predictions", [])
                            if predictions:
                                latest = predictions[-1]
                                ts = latest.get("prediction_made_time")
                                if ts != last_timestamp:
                                    last_timestamp = ts
                                    preds = latest.get("predictions", {})
                                    broadcast_data = {
                                        "type": "prediction_v23",
                                        "data": {
                                            "timestamp": ts,
                                            "current_price": latest.get("current_price"),
                                            "direction": latest.get("direction"),
                                            "confidence": latest.get("confidence"),
                                            "direction_1h": preds.get("1h", {}).get("direction_prob"),
                                            "direction_2h": preds.get("2h", {}).get("direction_prob"),
                                            "direction_4h": preds.get("4h", {}).get("direction_prob"),
                                            "magnitude_1h": preds.get("1h", {}).get("magnitude_pct"),
                                            "magnitude_2h": preds.get("2h", {}).get("magnitude_pct"),
                                            "magnitude_4h": preds.get("4h", {}).get("magnitude_pct"),
                                            "is_backfill": latest.get("is_backfill", False),
                                        }
                                    }
                                    await self.broadcast(broadcast_data)
                                    self.log("INFO", f"v2.3 prediction broadcast: {latest.get('direction')} conf={latest.get('confidence'):.0%}")
            except Exception as e:
                self.log("WARNING", f"v2.3 poll error: {e}")
            await asyncio.sleep(30)

    async def _heartbeat_loop(self) -> None:
        """Broadcast strategy heartbeats every 5 seconds matching UI_Server format."""
        while True:
            try:
                if self.strategy:
                    # Check if strategy wants to suppress heartbeats (for offline simulation)
                    should_suppress = False
                    if hasattr(self.strategy, "should_suppress_heartbeat"):
                        try:
                            should_suppress = self.strategy.should_suppress_heartbeat()
                        except Exception as e:
                            self.log("WARNING", f"Error checking heartbeat suppression: {e}")

                    if should_suppress:
                        # Skip sending heartbeat during offline simulation
                        await asyncio.sleep(5)
                        continue

                    # Get strategy state
                    strategy_state = {}
                    try:
                        strategy_state = self.strategy.get_strategy_state()
                    except Exception as e:
                        self.log("WARNING", f"Failed to get strategy state: {e}")

                    # Build heartbeat message matching UI_Server.py lines 888-896
                    instance_name = "TestStrategy" if self.test_mode else "IPC"
                    heartbeat_message = {
                        "type": "strategy_heartbeat",
                        "data": {
                            "instance_name": instance_name,
                            "instance_id": self.runtime_id,
                            "heartbeat_at": datetime.now(UTC).isoformat(),
                            "strategy_state": strategy_state,
                        },
                    }

                    await self.broadcast(heartbeat_message)

                await asyncio.sleep(5)  # Heartbeat every 5 seconds

            except Exception as e:
                self.log("ERROR", f"Error in heartbeat loop: {e}")
                await asyncio.sleep(5)

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        """Handle WebSocket connections from UI."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        self.ws_clients.add(ws)
        client_ip = request.remote or "unknown"
        self.log("INFO", f"WebSocket connected: {client_ip} (total: {len(self.ws_clients)})")

        try:
            # Send current state on connect (IPC strategy only)
            if self.strategy and isinstance(self.strategy, IPCStrategy) and self.strategy.active_signal:
                await ws.send_str(json.dumps({"type": "signal_state", "data": self.strategy.active_signal}))

            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    # UI can send messages (for future features)
                    pass
                elif msg.type == web.WSMsgType.ERROR:
                    self.log("ERROR", f"WebSocket error: {ws.exception()}")
        finally:
            self.ws_clients.discard(ws)
            self.log("INFO", f"WebSocket disconnected: {client_ip} (remaining: {len(self.ws_clients)})")

        return ws

    # ============================================
    # 5. HTTP API
    # ============================================

    async def handle_mode(self, request: web.Request) -> web.Response:
        """Return server mode information."""
        return web.json_response(
            {
                "mode": "live",
                "simulation": False,
                "features": {"ws_channels": ["ticks:compressed:binance:btcusdt"]},
                "version": "IPC_UI_Server",
                "timestamp": datetime.now(UTC).isoformat(),
            }
        )

    async def handle_strategy_instances(self, request: web.Request) -> web.Response:
        """Return IPC strategy instance for UI compatibility."""
        if self.test_mode:
            return web.json_response(["TestStrategy"])
        return web.json_response(["IPC"])

    async def handle_strategy_events(self, request: web.Request) -> web.Response:
        """
        Handle historic strategy events request (UI compatibility).

        For test mode, this triggers the test strategy to start immediately.
        For IPC mode, returns empty list (no historic events stored).
        """
        if self.test_mode and self.strategy and isinstance(self.strategy, SimpleTestStrategy):
            # Trigger test strategy to start immediately
            self.log("INFO", "📡 /api/strategy-events called - triggering test strategy start")
            asyncio.create_task(self.strategy.start())

        # Return empty list (no historic events for IPC_UI_Server)
        return web.json_response([])

    async def handle_index(self, request: web.Request) -> web.FileResponse:
        """Serve main UI page."""
        return web.FileResponse("./ui/chart.html")

    async def handle_telemetry_stub(self, request: web.Request) -> web.Response:
        """Stub handler for telemetry endpoints (traces, logs). Just accepts and ignores."""
        return web.Response(status=200)

    # ============================================
    # 6. SETUP & RUN
    # ============================================

    def setup_routes(self):
        """Setup HTTP routes."""
        # API endpoints
        self.app.router.add_get("/api/mode", self.handle_mode)
        self.app.router.add_get(
            "/api/strategy_instances", self.handle_strategy_instances
        )  # UI uses underscore
        self.app.router.add_get("/api/strategy-events", self.handle_strategy_events)
        self.app.router.add_get("/api/binance-klines", self.handle_binance_klines)
        self.app.router.add_get("/api/binance-aggTrades", self.handle_binance_aggtrades)
        self.app.router.add_get("/api/predictions", self.handle_predictions)
        self.app.router.add_get(
            "/api/historic-predictions", self.handle_predictions
        )  # UI expects this endpoint
        self.app.router.add_get("/api/backtest-trades", self.handle_backtest_trades)

        # WebSocket
        self.app.router.add_get("/ws", self.handle_websocket)

        # Stub routes for telemetry (silences 404 errors in browser console)
        self.app.router.add_post("/v1/traces", self.handle_telemetry_stub)
        self.app.router.add_post("/v1/logs", self.handle_telemetry_stub)
        self.app.router.add_post("/api/logs", self.handle_telemetry_stub)

        # Static files (UI)
        self.app.router.add_static("/js/", "./ui/js/")
        self.app.router.add_get("/", self.handle_index)
        self.app.router.add_get("/chart.html", self.handle_index)  # Also serve at /chart.html

    async def start(self):
        """Start the server and all background tasks."""
        self.log("INFO", "=" * 60)
        self.log("INFO", "IPC UI Server Starting")
        self.log("INFO", f"Prediction Mode: {'Standard' if self.use_standard_predictions else 'Enriched'}")
        self.log("INFO", "=" * 60)

        # Generate runtime ID for heartbeat tracking
        hostname = socket.gethostname()
        pid = os.getpid()
        self.runtime_id = f"{hostname}-{pid}-{int(datetime.now(UTC).timestamp())}"
        self.log("INFO", f"Runtime ID: {self.runtime_id}")

        # Initialize strategy based on mode
        if self.test_mode:
            self.log("INFO", "🧪 TEST MODE: Initializing Simple Test Strategy")
            self.strategy = SimpleTestStrategy(
                broadcast_callback=self.broadcast,
                log_callback=self.log,
                instance_name="TestStrategy",
                entry_delay_seconds=5,
                exit_delay_seconds=60,
                initial_stop_loss_points=2000,
                direction="LONG",
                # Offline simulation enabled by default (10s delay, 10s duration)
                # Uncomment to customize:
                # simulate_offline=True,
                # offline_start_delay=10.0,
                # offline_duration=10.0,
            )
            self.log("INFO", "✓ Simple Test Strategy initialized")
        else:
            self.log("INFO", "📊 LIVE MODE: Initializing IPC Strategy")
            self.strategy = IPCStrategy(
                broadcast_callback=self.broadcast,
                log_callback=self.log,
                instance_name="IPC",
                delta=500,
                initial_stop_loss_points=2000,
                trailing_activation_offset=1000,
                trailing_stop_distance=900,
                max_position_duration_hours=2,
                session_filter=True,
            )
            self.log("INFO", "✓ IPC Strategy initialized")

        # Initialize EAI Prediction Provider (manages its own ClickHouse connection)
        # Optional: If ClickHouse credentials are provided, predictions will be displayed
        # If not available, server continues without predictions
        self.log("INFO", "Initializing EAI Prediction Provider...")
        try:
            self.prediction_provider = EAIPredictionProvider(
                clickhouse_host=self.clickhouse_host,
                clickhouse_port=self.clickhouse_port,
                clickhouse_user=self.clickhouse_user,
                clickhouse_password=self.clickhouse_password,
                clickhouse_database=self.clickhouse_database,
            )
            self.log("INFO", "✓ EAI Prediction Provider initialized with ClickHouse connection")
            if self.test_mode:
                self.log("INFO", "🧪 Test mode: Predictions will be displayed if available in ClickHouse")

        except Exception as e:
            self.log("ERROR", f"Failed to initialize prediction provider: {e}")
            if self.test_mode:
                self.log("WARNING", "🧪 Test mode: Running without predictions (ClickHouse not available)")
            else:
                self.log("WARNING", "Running without prediction support")

        # Setup routes
        self.setup_routes()

        # Start background tasks
        self.log("INFO", "Starting Binance tick stream...")
        self.binance_ws_task = asyncio.create_task(self.start_binance_tick_stream())

        # Start prediction polling - use ClickHouse if available, otherwise fallback to Oracle API
        if self.prediction_provider:
            self.log("INFO", "Starting prediction polling via ClickHouse (every 30s)...")
            self.prediction_poll_task = asyncio.create_task(self.poll_latest_predictions())
        else:
            self.log("INFO", "ClickHouse not available - using Oracle API fallback for predictions...")
            self.prediction_poll_task = asyncio.create_task(self.poll_oracle_api_predictions())

        # Start v2.3 shadow prediction polling
        self.log("INFO", "Starting v2.3 shadow prediction polling (every 30s)...")
        self.v23_poll_task = asyncio.create_task(self.poll_v23_predictions())

        # Start strategy heartbeat
        self.log("INFO", "Starting strategy heartbeat (every 5s)...")
        self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Start HTTP server
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", self.port)
        await site.start()

        self.log("INFO", "=" * 60)
        self.log("INFO", f"✅ IPC UI Server running on http://0.0.0.0:{self.port}")
        self.log("INFO", "=" * 60)
        self.log("INFO", f"UI: http://localhost:{self.port}")
        self.log("INFO", f"WebSocket: ws://localhost:{self.port}/ws")
        self.log("INFO", "=" * 60)

        # Keep running
        try:
            await asyncio.Event().wait()
        except KeyboardInterrupt:
            self.log("INFO", "Shutting down...")

    async def stop(self):
        """Stop the server."""
        if self.binance_ws_task:
            self.binance_ws_task.cancel()
        if self.prediction_poll_task:
            self.prediction_poll_task.cancel()
        if self.v23_poll_task:
            self.v23_poll_task.cancel()
            try:
                await self.v23_poll_task
            except asyncio.CancelledError:
                pass
        if self.heartbeat_task:
            self.heartbeat_task.cancel()
            try:
                await self.heartbeat_task
            except asyncio.CancelledError:
                pass
        # Close prediction provider (closes its own ClickHouse connection)
        if self.prediction_provider:
            self.prediction_provider.close()


# ============================================
# MAIN
# ============================================


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="IPC UI Server - Purpose-built monitoring server")
    parser.add_argument("--port", type=int, default=8765, help="Port to run server on (default: 8765)")
    parser.add_argument("--log-level", default="INFO", help="Log level (default: INFO)")
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run in test mode using Simple_Test_Strategy instead of IPC strategy",
    )
    parser.add_argument(
        "--use-standard-predictions",
        action="store_true",
        help="Use standard predictions from eai_api_predictions table instead of enriched predictions",
    )

    args = parser.parse_args()

    server = IPCUIServer(
        port=args.port,
        log_level=args.log_level,
        test_mode=args.test,
        use_standard_predictions=args.use_standard_predictions,
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
