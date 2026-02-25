#!/usr/bin/env python3
# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
IPC_Strategy - Extracted IPC trading strategy logic

This module contains the IPC trading strategy. It generates trading signals
based on prediction data and manages positions with trailing stops.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo


class IPCStrategy:
    """
    IPC trading strategy with signal generation and position management.

    The strategy:
    - Generates signals when prediction delta exceeds threshold
    - Applies session filtering (NY 8am-11am ET)
    - Manages positions with stop loss and trailing stops
    - Enforces time limits on positions
    """

    def __init__(
        self,
        broadcast_callback: Callable[[dict[str, Any]], Any],
        log_callback: Callable[[str, str], None] | None = None,
        instance_name: str = "IPC",
        **params: Any,
    ):
        """
        Initialize the IPC strategy.

        Args:
            broadcast_callback: Async function to broadcast events to UI
            log_callback: Optional function for logging (level, message)
            instance_name: Strategy instance name for event tracking
            **params: Strategy parameters (delta, stop_loss, etc.)
        """
        # Callbacks
        self.broadcast = broadcast_callback
        self.log = log_callback or self._default_log

        # Instance tracking
        self.instance_name = instance_name
        self.event_counter = 0  # For generating unique event IDs

        # Strategy parameters
        self.delta = params.get("delta", 500)  # Price difference threshold
        self.initial_stop_loss_points = params.get("initial_stop_loss_points", 2000)
        self.trailing_activation_offset = params.get("trailing_activation_offset", 1000)
        self.trailing_stop_distance = params.get("trailing_stop_distance", 900)
        self.max_position_duration_hours = params.get("max_position_duration_hours", 2)
        self.session_filter = params.get("session_filter", True)  # NY session filter

        # State
        self.active_signal: dict[str, Any] | None = None
        self.trailing_stop_active = False
        self.peak_price: float | None = None
        self.trailing_stop_activation_price: float | None = None

        # Strategy state tracking
        self.strategy_state: dict[str, Any] = {}
        self._state_sequence: int = 0

    def _default_log(self, level: str, message: str) -> None:
        """Default logging if no callback provided."""
        timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")

    def _update_strategy_state(self) -> None:
        """Update strategy_state dict with current values and increment seq."""
        self._state_sequence += 1

        if not self.active_signal:
            # No position - empty state with seq
            self.strategy_state = {"seq": self._state_sequence}
        else:
            # Active position - full state with seq
            self.strategy_state = {
                "SL": self.active_signal.get("stop_loss"),
                "TP": self.active_signal.get("target"),
                "ENTRY": self.active_signal.get("entry_price"),
                "TSA": self.active_signal.get("trailing_activation_price"),
                "TRAILING_STOP_ACTIVE": self.trailing_stop_active,
                "seq": self._state_sequence,
            }

    async def check_signal_trigger(self, prediction: dict[str, Any], tick_data: dict[str, Any]) -> None:
        """
        Check if conditions met to generate new IPC signal.

        Args:
            prediction: Prediction data with price predictions
            tick_data: Current tick data with market price
        """
        if self.active_signal:
            return  # Already have active signal

        try:
            # Extract prediction data from structured fields
            current_price_pred = float(prediction.get("prediction_price", 0))
            predicted_price = float(prediction.get("predicted_price", 0))
            prediction_time_str = prediction.get("prediction_time", "")

            # Parse prediction time
            if prediction_time_str:
                prediction_time = datetime.fromisoformat(prediction_time_str.replace("Z", "+00:00"))
            else:
                return  # No valid prediction time

            # Get current tick price
            current_tick_price = float(tick_data.get("p", 0))

            # Calculate price difference
            price_diff = predicted_price - current_price_pred

            # Check delta threshold
            if abs(price_diff) <= self.delta:
                return  # Not significant enough

            # Check time window (8am-11am ET) if session filter enabled
            if self.session_filter:
                ny_tz = ZoneInfo("America/New_York")
                ny_time = prediction_time.astimezone(ny_tz)

                # Check if weekday and within session hours
                if ny_time.weekday() >= 5 or ny_time.hour < 8 or ny_time.hour >= 11:
                    return

            # Generate signal
            direction = "LONG" if price_diff > 0 else "SHORT"
            entry_price = current_tick_price

            if direction == "LONG":
                stop_loss = entry_price - self.initial_stop_loss_points
                trailing_activation = entry_price + self.trailing_activation_offset
            else:
                stop_loss = entry_price + self.initial_stop_loss_points
                trailing_activation = entry_price - self.trailing_activation_offset

            self.active_signal = {
                "direction": direction,
                "entry_price": entry_price,
                "stop_loss": stop_loss,
                "target": predicted_price,
                "trailing_activation_price": trailing_activation,
                "entry_time": datetime.now(UTC).isoformat(),
                "prediction_data": {
                    "prediction_price": current_price_pred,
                    "predicted_price": predicted_price,
                    "prediction_time": prediction_time_str,
                },
            }

            self.peak_price = entry_price
            self.trailing_stop_active = False

            self.log(
                "INFO",
                f"🚀 IPC SIGNAL GENERATED: {direction} @ {entry_price:.2f}, SL: {stop_loss:.2f}, Target: {predicted_price:.2f}",
            )

            # Generate unique event ID
            self.event_counter += 1
            event_id = (
                f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
            )
            event_time = datetime.now(UTC).isoformat()

            # Update strategy state
            self._update_strategy_state()

            # Broadcast signal to UI
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
                            "signal_direction": direction,
                            "entry_price": entry_price,
                            "predicted_price": predicted_price,
                            "stop_loss_price": stop_loss,
                            "trailing_activation_price": trailing_activation,
                            "prediction_data": {
                                "prediction_price": current_price_pred,
                                "predicted_price": predicted_price,
                                "prediction_time": prediction_time_str,
                            },
                            "strategy_state": self.strategy_state,
                        },
                    },
                }
            )

        except Exception as e:
            self.log("ERROR", f"Error checking signal trigger: {e}")

    async def check_position_management(self, tick_data: dict[str, Any]) -> None:
        """
        Manage active position (stop loss, trailing stop, time limit).

        Args:
            tick_data: Current tick data with market price
        """
        if not self.active_signal:
            return

        try:
            current_price = float(tick_data.get("p", 0))
            direction = self.active_signal["direction"]
            entry_price = self.active_signal["entry_price"]
            stop_loss = self.active_signal["stop_loss"]

            # Check time limit
            entry_time = datetime.fromisoformat(self.active_signal["entry_time"].replace("Z", "+00:00"))
            time_since_entry = datetime.now(UTC) - entry_time
            if time_since_entry > timedelta(hours=self.max_position_duration_hours):
                pnl = current_price - entry_price if direction == "LONG" else entry_price - current_price
                pnl_pct = (pnl / entry_price) * 100

                self.log(
                    "INFO",
                    f"⏰ TIME LIMIT HIT: {direction} position closed. PNL: ${pnl:.2f} ({pnl_pct:.2f}%)",
                )

                # Generate unique event ID
                self.event_counter += 1
                event_id = (
                    f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
                )
                event_time = datetime.now(UTC).isoformat()

                # Reset state
                self.active_signal = None
                self.trailing_stop_active = False
                self._update_strategy_state()  # Updates to empty state with seq

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
                                "direction": direction,
                                "entry_price": entry_price,
                                "current_price": current_price,
                                "pnl": pnl,
                                "pnl_percentage": pnl_pct,
                                "strategy_state": self.strategy_state,
                            },
                        },
                    }
                )

                return

            # Check stop loss and trailing stop
            if direction == "LONG":
                if current_price <= stop_loss:
                    await self.close_position(current_price, "STOP_LOSS_HIT")
                    return

                # Trailing stop logic
                if self.trailing_stop_active:
                    if current_price > self.peak_price:
                        self.peak_price = current_price
                        new_sl = self.peak_price - self.trailing_stop_distance
                        self.active_signal["stop_loss"] = new_sl

                        # Generate unique event ID
                        self.event_counter += 1
                        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
                        event_time = datetime.now(UTC).isoformat()

                        # Update strategy state
                        self._update_strategy_state()

                        await self.broadcast(
                            {
                                "type": "strategy_event",
                                "data": {
                                    "event_id": event_id,
                                    "event_time": event_time,
                                    "strategy_instance_id": self.instance_name,
                                    "instance_name": self.instance_name,
                                    "position": "UPDATE",
                                    "reason": "TRAILING_STOP_UPDATED",
                                    "strategy_state": self.strategy_state,
                                    "event_data": {
                                        "direction": direction,
                                        "entry_price": entry_price,
                                        "stop_loss_price": new_sl,
                                        "peak_price": self.peak_price,
                                        "trailing_stop_activated": True,
                                        "current_price": current_price,
                                        "strategy_state": self.strategy_state,
                                    },
                                },
                            }
                        )
                elif current_price >= self.active_signal["trailing_activation_price"]:
                    self.trailing_stop_active = True
                    self.peak_price = current_price
                    new_sl = self.peak_price - self.trailing_stop_distance
                    self.active_signal["stop_loss"] = new_sl

                    self.log(
                        "INFO",
                        f"🎯 TRAILING STOP ACTIVATED: Peak ${self.peak_price:.2f}, New SL ${new_sl:.2f}",
                    )

                    # Generate unique event ID
                    self.event_counter += 1
                    event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
                    event_time = datetime.now(UTC).isoformat()

                    # Update strategy state
                    self._update_strategy_state()

                    await self.broadcast(
                        {
                            "type": "strategy_event",
                            "data": {
                                "event_id": event_id,
                                "event_time": event_time,
                                "strategy_instance_id": self.instance_name,
                                "instance_name": self.instance_name,
                                "position": "UPDATE",
                                "reason": "TRAILING_STOP_ACTIVATED",
                                "strategy_state": self.strategy_state,
                                "event_data": {
                                    "direction": direction,
                                    "entry_price": entry_price,
                                    "stop_loss_price": new_sl,
                                    "peak_price": self.peak_price,
                                    "trailing_stop_activated": True,
                                    "current_price": current_price,
                                    "strategy_state": self.strategy_state,
                                },
                            },
                        }
                    )

            else:  # SHORT
                if current_price >= stop_loss:
                    await self.close_position(current_price, "STOP_LOSS_HIT")
                    return

                # Trailing stop logic for SHORT
                if self.trailing_stop_active:
                    if current_price < self.peak_price:
                        self.peak_price = current_price
                        new_sl = self.peak_price + self.trailing_stop_distance
                        self.active_signal["stop_loss"] = new_sl

                        # Generate unique event ID
                        self.event_counter += 1
                        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
                        event_time = datetime.now(UTC).isoformat()

                        # Update strategy state
                        self._update_strategy_state()

                        await self.broadcast(
                            {
                                "type": "strategy_event",
                                "data": {
                                    "event_id": event_id,
                                    "event_time": event_time,
                                    "strategy_instance_id": self.instance_name,
                                    "instance_name": self.instance_name,
                                    "position": "UPDATE",
                                    "reason": "TRAILING_STOP_UPDATED",
                                    "strategy_state": self.strategy_state,
                                    "event_data": {
                                        "direction": direction,
                                        "entry_price": entry_price,
                                        "stop_loss_price": new_sl,
                                        "peak_price": self.peak_price,
                                        "trailing_stop_activated": True,
                                        "current_price": current_price,
                                        "strategy_state": self.strategy_state,
                                    },
                                },
                            }
                        )
                elif current_price <= self.active_signal["trailing_activation_price"]:
                    self.trailing_stop_active = True
                    self.peak_price = current_price
                    new_sl = self.peak_price + self.trailing_stop_distance
                    self.active_signal["stop_loss"] = new_sl

                    self.log(
                        "INFO",
                        f"🎯 TRAILING STOP ACTIVATED: Peak ${self.peak_price:.2f}, New SL ${new_sl:.2f}",
                    )

                    # Generate unique event ID
                    self.event_counter += 1
                    event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
                    event_time = datetime.now(UTC).isoformat()

                    # Update strategy state
                    self._update_strategy_state()

                    await self.broadcast(
                        {
                            "type": "strategy_event",
                            "data": {
                                "event_id": event_id,
                                "event_time": event_time,
                                "strategy_instance_id": self.instance_name,
                                "instance_name": self.instance_name,
                                "position": "UPDATE",
                                "reason": "TRAILING_STOP_ACTIVATED",
                                "strategy_state": self.strategy_state,
                                "event_data": {
                                    "direction": direction,
                                    "entry_price": entry_price,
                                    "stop_loss_price": new_sl,
                                    "peak_price": self.peak_price,
                                    "trailing_stop_activated": True,
                                    "current_price": current_price,
                                    "strategy_state": self.strategy_state,
                                },
                            },
                        }
                    )

        except Exception as e:
            self.log("ERROR", f"Error in position management: {e}")

    async def close_position(self, exit_price: float, reason: str) -> None:
        """
        Close active position.

        Args:
            exit_price: Price at which position is closed
            reason: Reason for closing (STOP_LOSS_HIT, etc.)
        """
        if not self.active_signal:
            return

        direction = self.active_signal["direction"]
        entry_price = self.active_signal["entry_price"]
        stop_loss = self.active_signal["stop_loss"]

        pnl = exit_price - entry_price if direction == "LONG" else entry_price - exit_price
        pnl_pct = (pnl / entry_price) * 100

        self.log(
            "INFO",
            f"🛑 {reason}: {direction} position closed @ ${exit_price:.2f}. PNL: ${pnl:.2f} ({pnl_pct:.2f}%)",
        )

        # Generate unique event ID
        self.event_counter += 1
        event_id = f"{self.instance_name}_{self.event_counter}_{int(datetime.now(UTC).timestamp() * 1000)}"
        event_time = datetime.now(UTC).isoformat()

        # Reset state
        self.active_signal = None
        self.trailing_stop_active = False
        self.peak_price = None
        self._update_strategy_state()  # Updates to empty state with seq

        await self.broadcast(
            {
                "type": "strategy_event",
                "data": {
                    "event_id": event_id,
                    "event_time": event_time,
                    "strategy_instance_id": self.instance_name,
                    "instance_name": self.instance_name,
                    "position": "CLOSE",
                    "reason": reason,
                    "strategy_state": self.strategy_state,
                    "event_data": {
                        "direction": direction,
                        "entry_price": entry_price,
                        "stop_loss_price": stop_loss,
                        "current_price": exit_price,
                        "pnl": pnl,
                        "pnl_percentage": pnl_pct,
                        "strategy_state": self.strategy_state,
                    },
                },
            }
        )

    def get_strategy_state(self) -> dict[str, Any]:
        """Return current strategy state for UI display."""
        return self.strategy_state.copy()
