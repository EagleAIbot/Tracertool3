#!/usr/bin/env python3
# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
Simple_Test_Strategy - Test strategy for UI development

A simplified test strategy based on UI_Test_Strategy.py but without
framework dependencies. Uses the same broadcast callback pattern as IPCStrategy.

Predictable behavior:
- Waits for API trigger + 5 seconds
- Enters trade X seconds after trigger
- Sets stop loss, target, and trailing stop activation price
- Simulates price movement through TSA and past target
- Implements trailing stop activation and dynamic stop loss updates
- Broadcasts UPDATE events when trailing stop activates/moves
- Exits trade Y seconds after entry (time limit)
- Optional offline simulation: Goes offline N seconds after OPEN for M seconds
  - Suppresses heartbeat and event broadcasts completely
  - Strategy continues internal processing but appears offline to UI
  - UI detects staleness and greys out lines
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any


class SimpleTestStrategy:
    """
    Simple test strategy for UI development with predictable timing.

    Sequence:
    1. Wait for start_delayed() call (triggered by fetchHistoricStrategyEvents)
    2. Wait 5 seconds
    3. Wait entry_delay_seconds
    4. Enter trade with stop loss, target, and trailing stop activation price
    5. Simulate price movement through TSA and past target (if enabled)
       - Price moves gradually from entry to 10% beyond target
       - Triggers trailing stop activation at TSA
       - Updates trailing stop as price moves
       - Broadcasts UPDATE events for UI
    6. Optional: Simulate offline mode N seconds after OPEN for M seconds
       - Strategy continues processing internally (state updates, trailing stops)
       - Heartbeat broadcasts are completely suppressed (no heartbeats sent)
       - Event broadcasts are suppressed (no UPDATE events sent)
       - UI will detect strategy as stale/offline and grey out lines
    7. Exit trade after exit_delay_seconds
    """

    def __init__(
        self,
        broadcast_callback: Callable[[dict[str, Any]], Any],
        log_callback: Callable[[str, str], None] | None = None,
        instance_name: str = "TestStrategy",
        **params: Any,
    ):
        """
        Initialize the test strategy.

        Args:
            broadcast_callback: Async function to broadcast events to UI
            log_callback: Optional function for logging (level, message)
            instance_name: Strategy instance name for event tracking
            **params: Strategy parameters:
                - entry_delay_seconds: Seconds to wait before entering trade (default: 5)
                - exit_delay_seconds: Seconds to wait before exiting trade (default: 60)
                - initial_stop_loss_points: Points away from entry for initial SL (default: 2000)
                - trailing_activation_offset: Points from entry where TSA activates (default: 1000)
                - trailing_stop_distance: Points behind peak for trailing SL (default: 900)
                - direction: Trade direction "LONG" or "SHORT" (default: "LONG")
                - simulate_price_movement: Enable price simulation (default: True)
                - price_simulation_interval: Seconds between simulated ticks (default: 2.0)
                - simulate_offline: Enable offline simulation (default: True)
                - offline_start_delay: Seconds after OPEN to go offline (default: 10.0)
                - offline_duration: Seconds to remain offline (default: 10.0)
        """
        # Callbacks
        self.broadcast = broadcast_callback
        self.log = log_callback or self._default_log

        # Instance tracking
        self.instance_name = instance_name
        self.event_counter = 0  # For generating unique event IDs

        # Configurable parameters
        self.entry_delay_seconds = params.get("entry_delay_seconds", 5)  # After trigger
        self.exit_delay_seconds = params.get("exit_delay_seconds", 60)  # After entry
        self.initial_stop_loss_points = params.get("initial_stop_loss_points", 2000)
        self.trailing_activation_offset = params.get(
            "trailing_activation_offset", 1000
        )  # Points before trailing activates
        self.trailing_stop_distance = params.get(
            "trailing_stop_distance", 900
        )  # Points behind peak for trailing SL
        self.direction = params.get("direction", "LONG")  # LONG or SHORT
        self.simulate_price_movement = params.get("simulate_price_movement", True)  # Simulate price ticks
        self.price_simulation_interval = params.get(
            "price_simulation_interval", 2.0
        )  # Seconds between simulated ticks

        # Offline simulation parameters
        self.simulate_offline = params.get("simulate_offline", True)  # Enable offline simulation
        self.offline_start_delay = params.get("offline_start_delay", 10.0)  # Seconds after OPEN to go offline
        self.offline_duration = params.get("offline_duration", 10.0)  # Seconds to remain offline

        # Strategy state
        self.is_running = False
        self.start_time: datetime | None = None
        self.entry_time: datetime | None = None
        self.entry_price: float | None = None
        self.current_price: float | None = None  # Track current market price from ticks
        self.stop_loss_price: float | None = None
        self.target_price: float | None = None
        self.trailing_activation_price: float | None = None
        self.trailing_stop_active: bool = False
        self.peak_price: float | None = None

        # Task management
        self.strategy_task: asyncio.Task | None = None

        # Strategy state tracking
        self.strategy_state: dict[str, Any] = {}
        self._state_sequence: int = 0
        self._offline_frozen_state: dict[str, Any] | None = None  # State snapshot before going offline

    def _default_log(self, level: str, message: str) -> None:
        """Default logging if no callback provided."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")

    def _is_in_offline_window(self) -> bool:
        """Check if we're currently in the offline simulation window."""
        if not self.simulate_offline:
            return False

        if not self.entry_time:
            return False

        time_since_entry = (datetime.now(UTC) - self.entry_time).total_seconds()
        offline_start = self.offline_start_delay
        offline_end = self.offline_start_delay + self.offline_duration

        is_offline = offline_start <= time_since_entry < offline_end

        # Debug logging to help troubleshoot
        if is_offline and not hasattr(self, "_logged_offline_start"):
            self._logged_offline_start = True
            self.log("INFO", f"🔍 DEBUG: Entering offline window at {time_since_entry:.1f}s after entry")

        return is_offline

    def _update_strategy_state(self) -> None:
        """Update strategy_state dict with current values and increment seq."""
        self._state_sequence += 1

        if not self.entry_price:
            # No position - empty state with seq
            self.strategy_state = {"seq": self._state_sequence}
        else:
            # Active position - full state with seq
            self.strategy_state = {
                "SL": self.stop_loss_price,
                "TP": self.target_price,
                "ENTRY": self.entry_price,
                "TSA": self.trailing_activation_price,
                "TRAILING_STOP_ACTIVE": self.trailing_stop_active,
                "seq": self._state_sequence,
            }

    async def start_delayed(self, delay_seconds: int = 5) -> None:
        """
        Start the strategy after a delay (triggered by API call).

        Args:
            delay_seconds: Delay in seconds before starting (default 5)
        """
        if self.is_running:
            self.log("INFO", "Test strategy already running, ignoring start request")
            return  # Already running

        self.log("INFO", f"⏳ Test strategy will start in {delay_seconds} seconds...")
        await asyncio.sleep(delay_seconds)
        await self.start()

    async def start(self) -> None:
        """Start the test strategy."""
        self.is_running = True
        self.start_time = datetime.now(UTC)
        self._reset_strategy_state()

        self.log("INFO", f"🚀 Simple Test Strategy STARTED at {self.start_time}")
        self.log("INFO", f"   - Entry delay: {self.entry_delay_seconds}s")
        self.log("INFO", f"   - Exit delay: {self.exit_delay_seconds}s")
        self.log("INFO", f"   - Direction: {self.direction}")
        self.log("INFO", f"   - Stop Loss Points: {self.initial_stop_loss_points}")
        self.log("INFO", f"   - Trailing Activation Offset: {self.trailing_activation_offset}")
        self.log("INFO", f"   - Trailing Stop Distance: {self.trailing_stop_distance}")
        self.log(
            "INFO", f"   - Price Simulation: {'ENABLED' if self.simulate_price_movement else 'DISABLED'}"
        )
        if self.simulate_price_movement:
            self.log("INFO", f"   - Simulation Interval: {self.price_simulation_interval}s")
        self.log("INFO", f"   - Offline Simulation: {'ENABLED' if self.simulate_offline else 'DISABLED'}")
        if self.simulate_offline:
            self.log("INFO", f"   - Offline Start: {self.offline_start_delay}s after OPEN")
            self.log("INFO", f"   - Offline Duration: {self.offline_duration}s")

        # Start the strategy execution task
        self.strategy_task = asyncio.create_task(self._run_strategy_sequence())

    async def stop(self) -> None:
        """Stop the test strategy."""
        self.log("INFO", "🛑 STOPPING Simple Test Strategy...")
        self.is_running = False

        if self.strategy_task and not self.strategy_task.done():
            self.log("INFO", "🔄 Cancelling strategy task...")
            self.strategy_task.cancel()
            try:
                await self.strategy_task
            except asyncio.CancelledError:
                self.log("INFO", "✅ Strategy task cancelled successfully")

        self._reset_strategy_state()
        self.log("INFO", "✅ Simple Test Strategy STOPPED")

    async def _run_strategy_sequence(self) -> None:
        """Execute the predictable test sequence."""
        try:
            # Phase 1: Wait for entry delay
            self.log("INFO", f"⏳ PHASE 1: Waiting {self.entry_delay_seconds}s before entry...")
            await asyncio.sleep(self.entry_delay_seconds)

            if not self.is_running:
                self.log("INFO", "❌ Strategy stopped during entry delay")
                return

            # Phase 2: Enter trade
            self.log("INFO", f"📈 PHASE 2: Entering {self.direction} trade...")
            await self._enter_trade()

            # Phase 3: Wait for exit time (with optional price simulation)
            if self.simulate_price_movement:
                self.log("INFO", f"⏳ PHASE 3: Simulating price movement for {self.exit_delay_seconds}s...")
                await self._simulate_price_movement_to_target()
            else:
                self.log("INFO", f"⏳ PHASE 3: Waiting {self.exit_delay_seconds}s until exit...")
                await asyncio.sleep(self.exit_delay_seconds)

            if not self.is_running or not self.entry_time:
                self.log("INFO", "❌ Strategy stopped during exit wait")
                return

            # Phase 4: Exit trade (time limit)
            self.log("INFO", "🏁 PHASE 4: Exiting trade (time limit reached)...")
            await self._exit_trade_time_limit()

        except asyncio.CancelledError:
            self.log("INFO", "🛑 Strategy sequence CANCELLED")
        except Exception as e:
            self.log("ERROR", f"💥 ERROR in strategy sequence: {e}")
            import traceback

            self.log("ERROR", f"Traceback: {traceback.format_exc()}")

    async def _enter_trade(self) -> None:
        """Enter a test trade with stop loss and target."""
        self.entry_time = datetime.now(UTC)

        # Use current market price as entry price, fallback to 50000 if no ticks received yet
        self.entry_price = self.current_price if self.current_price is not None else 50000.0

        # Calculate stop loss, target, and trailing activation based on direction
        if self.direction == "LONG":
            self.stop_loss_price = self.entry_price - self.initial_stop_loss_points
            self.target_price = self.entry_price + self.initial_stop_loss_points  # 1:1 risk/reward for test
            self.trailing_activation_price = self.entry_price + self.trailing_activation_offset
        else:  # SHORT
            self.stop_loss_price = self.entry_price + self.initial_stop_loss_points
            self.target_price = self.entry_price - self.initial_stop_loss_points  # 1:1 risk/reward for test
            self.trailing_activation_price = self.entry_price - self.trailing_activation_offset

        # Initialize trailing stop state
        self.trailing_stop_active = False
        self.peak_price = self.entry_price

        self.log("INFO", f"✅ ENTERED {self.direction} position at ${self.entry_price:,.2f}")
        self.log("INFO", f"🛡️ Stop Loss: ${self.stop_loss_price:,.2f}")
        self.log("INFO", f"🎯 Target: ${self.target_price:,.2f}")
        self.log("INFO", f"📊 Trailing Stop Activates at: ${self.trailing_activation_price:,.2f}")

        # Generate unique event ID
        self.event_counter += 1
        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
        event_time = datetime.now(UTC).isoformat()

        # Update strategy state
        self._update_strategy_state()

        # Broadcast OPEN event
        await self.broadcast(
            {
                "type": "strategy_event",
                "data": {
                    "event_id": event_id,
                    "event_time": event_time,
                    "strategy_instance_id": self.instance_name,
                    "instance_name": self.instance_name,
                    "position": "OPEN",
                    "reason": "SIGNAL_DETECTED",
                    "strategy_state": self.strategy_state,
                    "event_data": {
                        "signal_direction": self.direction,
                        "entry_price": self.entry_price,
                        "predicted_price": self.target_price,
                        "stop_loss_price": self.stop_loss_price,
                        "prediction_data": {},
                        "strategy_state": self.strategy_state,
                    },
                },
            }
        )

    async def _exit_trade_time_limit(self) -> None:
        """Exit trade due to time limit."""
        if not self.entry_time or not self.entry_price:
            return

        # Use current market price for exit, fallback to entry price if no recent ticks
        current_price = self.current_price if self.current_price is not None else self.entry_price
        pnl = self._calculate_pnl(current_price)
        pnl_percentage = (pnl / self.entry_price) * 100

        pnl_emoji = "💚" if pnl >= 0 else "❤️"
        self.log("INFO", f"🏁 TIME LIMIT EXIT: Price=${current_price:,.2f}")
        self.log("INFO", f"{pnl_emoji} PNL: ${pnl:,.2f} ({pnl_percentage:+.2f}%)")
        self.log("INFO", f"⏱️ Trade duration: {self.exit_delay_seconds}s")

        # Generate unique event ID
        self.event_counter += 1
        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
        event_time = datetime.now(UTC).isoformat()

        # Reset strategy state before broadcast
        self._reset_strategy_state()

        # Broadcast CLOSE event
        await self.broadcast(
            {
                "type": "strategy_event",
                "data": {
                    "event_id": event_id,
                    "event_time": event_time,
                    "strategy_instance_id": self.instance_name,
                    "instance_name": self.instance_name,
                    "position": "CLOSE",
                    "reason": "POSITION_TIME_LIMIT_HIT",
                    "strategy_state": self.strategy_state,
                    "event_data": {
                        "direction": self.direction,
                        "entry_price": self.entry_price,
                        "current_price": current_price,
                        "pnl": pnl,
                        "pnl_percentage": pnl_percentage,
                        "strategy_state": self.strategy_state,
                    },
                },
            }
        )

    def _calculate_pnl(self, current_price: float) -> float:
        """Calculate PNL based on direction."""
        if not self.entry_price:
            return 0.0

        if self.direction == "LONG":
            return current_price - self.entry_price
        else:  # SHORT
            return self.entry_price - current_price

    def _reset_strategy_state(self) -> None:
        """Reset all strategy state variables."""
        self.entry_time = None
        self.entry_price = None
        self.stop_loss_price = None
        self.target_price = None
        self.trailing_activation_price = None
        self.trailing_stop_active = False
        self.peak_price = None
        self._offline_frozen_state = None  # Clear frozen state
        # Clear debug flags for next run
        if hasattr(self, "_logged_offline_start"):
            delattr(self, "_logged_offline_start")
        if hasattr(self, "_logged_suppression"):
            delattr(self, "_logged_suppression")
        self._update_strategy_state()  # Updates to empty state with seq

    def should_suppress_heartbeat(self) -> bool:
        """Check if heartbeats should be suppressed (for offline simulation)."""
        is_suppressed = self._is_in_offline_window()

        # Debug logging first time we suppress
        if is_suppressed and not hasattr(self, "_logged_suppression"):
            self._logged_suppression = True
            self.log("INFO", "🔇 DEBUG: Suppressing heartbeat - offline mode active")

        return is_suppressed

    def get_strategy_state(self) -> dict[str, Any]:
        """Return current strategy state for UI display."""
        # Check if we're in offline window
        in_offline = self._is_in_offline_window()

        if in_offline:
            # Capture frozen state on first call during offline window
            if self._offline_frozen_state is None:
                self._offline_frozen_state = self.strategy_state.copy()
                self.log(
                    "INFO",
                    f"📴 OFFLINE MODE: Freezing state at seq={self._offline_frozen_state.get('seq', 'unknown')}",
                )
            # Return frozen state during offline window (not actually used since heartbeats are suppressed)
            return self._offline_frozen_state.copy()

        # We're not in offline window anymore - check if we were offline before
        if self._offline_frozen_state is not None:
            self.log("INFO", f"📶 BACK ONLINE: Resuming state updates at seq={self._state_sequence}")
            self._offline_frozen_state = None  # Clear frozen state

        return self.strategy_state.copy()

    async def process_tick(self, tick_data: dict[str, Any]) -> None:
        """
        Process incoming tick data to track current market price and manage trailing stops.

        Args:
            tick_data: Tick data with price information
        """
        try:
            # Extract price from tick data
            old_price = self.current_price
            if "price" in tick_data:
                self.current_price = float(tick_data["price"])
            elif "p" in tick_data:  # Compressed format
                self.current_price = float(tick_data["p"])

            # Log first tick received
            if old_price is None and self.current_price is not None:
                self.log("INFO", f"📡 First tick received: ${self.current_price:,.2f}")

            # Process trailing stop logic if in position
            if self.entry_price is not None and self.current_price is not None:
                await self._check_trailing_stop(self.current_price)

        except (ValueError, KeyError) as e:
            self.log("WARNING", f"⚠️ Failed to parse tick data: {e}")

    async def _simulate_price_movement_to_target(self) -> None:
        """
        Simulate price movement from entry through TSA and past target.

        This simulates realistic price progression:
        - LONG: Price gradually moves up through TSA to above target
        - SHORT: Price gradually moves down through TSA to below target
        """
        if not self.entry_price or not self.target_price or not self.trailing_activation_price:
            return

        # Calculate price path
        if self.direction == "LONG":
            # Move from entry to 10% past target
            target_overshoot = self.target_price + (self.initial_stop_loss_points * 0.1)
            price_range = target_overshoot - self.entry_price
        else:  # SHORT
            # Move from entry to 10% past target
            target_overshoot = self.target_price - (self.initial_stop_loss_points * 0.1)
            price_range = self.entry_price - target_overshoot

        # Calculate number of steps and price increment per step
        num_steps = int(self.exit_delay_seconds / self.price_simulation_interval)
        if num_steps == 0:
            num_steps = 1

        price_step = price_range / num_steps

        self.log("INFO", f"💫 Simulating {num_steps} price movements over {self.exit_delay_seconds}s")
        self.log("INFO", f"   Price path: ${self.entry_price:,.2f} → ${target_overshoot:,.2f}")

        # Simulate price movements
        current_simulated_price = self.entry_price
        for step in range(num_steps):
            if not self.is_running:
                break

            # Update simulated price
            if self.direction == "LONG":
                current_simulated_price += price_step
            else:  # SHORT
                current_simulated_price -= price_step

            # Create simulated tick data
            simulated_tick = {
                "p": current_simulated_price,  # price
                "simulated": True,
            }

            # Process the tick (will trigger trailing stop logic)
            await self.process_tick(simulated_tick)

            # Log key milestones
            if not self.trailing_stop_active and self.trailing_activation_price:
                # Check if we just crossed TSA
                if self.direction == "LONG" and current_simulated_price >= self.trailing_activation_price:
                    pass  # Will be logged by _check_trailing_stop
                elif self.direction == "SHORT" and current_simulated_price <= self.trailing_activation_price:
                    pass  # Will be logged by _check_trailing_stop

            # Wait before next simulation step
            await asyncio.sleep(self.price_simulation_interval)

        self.log("INFO", f"✅ Price simulation complete. Final price: ${current_simulated_price:,.2f}")

    async def _check_trailing_stop(self, current_price: float) -> None:
        """
        Check and update trailing stop logic based on current price.

        Args:
            current_price: Current market price
        """
        if not self.entry_price or not self.stop_loss_price or not self.trailing_activation_price:
            return

        # LONG position logic
        if self.direction == "LONG":
            # Check if trailing stop should activate
            if not self.trailing_stop_active and current_price >= self.trailing_activation_price:
                self.trailing_stop_active = True
                self.peak_price = current_price
                new_sl = self.peak_price - self.trailing_stop_distance
                self.stop_loss_price = new_sl

                self.log("INFO", f"🎯 TRAILING STOP ACTIVATED at ${current_price:,.2f}")
                self.log("INFO", f"   New Stop Loss: ${new_sl:,.2f}")

                # Broadcast trailing stop activation event
                await self._broadcast_trailing_stop_update(current_price, "ACTIVATED")

            # If trailing stop active, update peak and stop loss
            elif self.trailing_stop_active and current_price > self.peak_price:
                old_peak = self.peak_price
                self.peak_price = current_price
                new_sl = self.peak_price - self.trailing_stop_distance
                old_sl = self.stop_loss_price
                self.stop_loss_price = new_sl

                self.log("INFO", f"📈 TRAILING STOP UPDATED: Peak ${old_peak:,.2f} → ${self.peak_price:,.2f}")
                self.log("INFO", f"   Stop Loss: ${old_sl:,.2f} → ${new_sl:,.2f}")

                # Broadcast trailing stop update event
                await self._broadcast_trailing_stop_update(current_price, "UPDATED")

        # SHORT position logic
        else:
            # Check if trailing stop should activate
            if not self.trailing_stop_active and current_price <= self.trailing_activation_price:
                self.trailing_stop_active = True
                self.peak_price = current_price
                new_sl = self.peak_price + self.trailing_stop_distance
                self.stop_loss_price = new_sl

                self.log("INFO", f"🎯 TRAILING STOP ACTIVATED at ${current_price:,.2f}")
                self.log("INFO", f"   New Stop Loss: ${new_sl:,.2f}")

                # Broadcast trailing stop activation event
                await self._broadcast_trailing_stop_update(current_price, "ACTIVATED")

            # If trailing stop active, update peak and stop loss
            elif self.trailing_stop_active and current_price < self.peak_price:
                old_peak = self.peak_price
                self.peak_price = current_price
                new_sl = self.peak_price + self.trailing_stop_distance
                old_sl = self.stop_loss_price
                self.stop_loss_price = new_sl

                self.log("INFO", f"📉 TRAILING STOP UPDATED: Peak ${old_peak:,.2f} → ${self.peak_price:,.2f}")
                self.log("INFO", f"   Stop Loss: ${old_sl:,.2f} → ${new_sl:,.2f}")

                # Broadcast trailing stop update event
                await self._broadcast_trailing_stop_update(current_price, "UPDATED")

    async def _broadcast_trailing_stop_update(self, current_price: float, update_type: str) -> None:
        """
        Broadcast trailing stop update event to UI.

        Args:
            current_price: Current market price
            update_type: Type of update ("ACTIVATED" or "UPDATED")
        """
        # Update strategy state (even if offline, keep internal state updated)
        self._update_strategy_state()

        # Suppress broadcasts during offline window to simulate strategy being offline
        if self._is_in_offline_window():
            self.log("DEBUG", f"🔇 OFFLINE: Suppressing {update_type} broadcast during offline window")
            return

        # Generate unique event ID
        self.event_counter += 1
        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
        event_time = datetime.now(UTC).isoformat()

        # Broadcast UPDATE event
        await self.broadcast(
            {
                "type": "strategy_event",
                "data": {
                    "event_id": event_id,
                    "event_time": event_time,
                    "strategy_instance_id": self.instance_name,
                    "instance_name": self.instance_name,
                    "position": "UPDATE",
                    "reason": f"TRAILING_STOP_{update_type}",
                    "strategy_state": self.strategy_state,
                    "event_data": {
                        "direction": self.direction,
                        "entry_price": self.entry_price,
                        "stop_loss_price": self.stop_loss_price,
                        "peak_price": self.peak_price,
                        "trailing_stop_activated": True,
                        "current_price": current_price,
                        "strategy_state": self.strategy_state,
                    },
                },
            }
        )
