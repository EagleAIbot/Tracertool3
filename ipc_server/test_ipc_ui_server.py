#!/usr/bin/env python3
# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
Test script for ipc_ui_server

Demonstrates basic functionality without requiring full setup.

Usage:
    python ipc_server/test_ipc_ui_server.py           # Test WebSocket (default)
    python ipc_server/test_ipc_ui_server.py http      # Test HTTP endpoints
"""

import asyncio
import json

import websockets


async def test_websocket():
    """Test WebSocket connection and message reception."""
    uri = "ws://localhost:8765/ws"

    print("Connecting to IPC UI Server WebSocket...")
    print(f"URI: {uri}")
    print()

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ Connected successfully!")
            print("Listening for messages (Ctrl+C to stop)...")
            print("-" * 60)

            async for message in websocket:
                try:
                    data = json.loads(message)
                    msg_type = data.get("type", "unknown")

                    if msg_type == "trade":
                        tick_data = data.get("data", {})
                        price = tick_data.get("p", "N/A")
                        print(f"[TICK] Price: ${price}")

                    elif msg_type == "prediction":
                        pred_data = data.get("data", {}).get("data", {})
                        predicted = pred_data.get("predictedMarketPrice", "N/A")
                        hours = pred_data.get("hours", "N/A")
                        print(f"[PREDICTION] {hours}h → ${predicted}")

                    elif msg_type == "strategy_event":
                        event = data.get("data", {})
                        position = event.get("position", "?")
                        reason = event.get("reason", "?")
                        event_data = event.get("event_data", {})

                        if position == "OPEN":
                            direction = event_data.get("signal_direction", "?")
                            entry = event_data.get("entry_price", 0)
                            sl = event_data.get("stop_loss_price", 0)
                            print(f"[SIGNAL] 🚀 {direction} @ ${entry:.2f}, SL: ${sl:.2f}")

                        elif position == "CLOSE":
                            pnl = event_data.get("pnl", 0)
                            pnl_pct = event_data.get("pnl_percentage", 0)
                            print(f"[CLOSE] 🛑 {reason}, PNL: ${pnl:.2f} ({pnl_pct:.2f}%)")

                        elif position == "UPDATE":
                            if "TRAILING" in reason:
                                new_sl = event_data.get("stop_loss_price", 0)
                                print(f"[UPDATE] 🎯 {reason}, New SL: ${new_sl:.2f}")

                    else:
                        print(f"[{msg_type.upper()}] {json.dumps(data, indent=2)[:200]}...")

                except json.JSONDecodeError:
                    print(f"[ERROR] Invalid JSON: {message[:100]}")
                except Exception as e:
                    print(f"[ERROR] {e}")

    except ConnectionRefusedError:
        print("❌ Connection refused. Is the server running?")
        print()
        print("Start the server with:")
        print("  python -m ipc_server.ipc_ui_server")
        print("  or: python -m ipc_server.ipc_ui_server")
        print()
    except KeyboardInterrupt:
        print("\n\nStopped by user")
    except Exception as e:
        print(f"❌ Error: {e}")


async def test_http_api():
    """Test HTTP API endpoints."""
    import aiohttp

    base_url = "http://localhost:8765"

    print("Testing HTTP API endpoints...")
    print(f"Base URL: {base_url}")
    print()

    async with aiohttp.ClientSession() as session:
        # Test mode endpoint
        try:
            async with session.get(f"{base_url}/api/mode") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"✅ /api/mode → {data['mode']}")
                else:
                    print(f"❌ /api/mode → HTTP {resp.status}")
        except Exception as e:
            print(f"❌ /api/mode → {e}")

        # Test predictions endpoint
        try:
            async with session.get(f"{base_url}/api/predictions") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"✅ /api/predictions → {len(data)} cached predictions")
                else:
                    print(f"❌ /api/predictions → HTTP {resp.status}")
        except Exception as e:
            print(f"❌ /api/predictions → {e}")

    print()


async def main():
    """Main test function."""
    import sys

    print("=" * 60)
    print("IPC UI Server Test Script")
    print("=" * 60)
    print()

    if len(sys.argv) > 1 and sys.argv[1] == "http":
        await test_http_api()
    else:
        await test_websocket()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nExiting...")
