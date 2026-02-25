# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
IPC Server - Extracted IPC trading strategy and UI server.

This package contains:
- ipc_strategy: The IPC trading strategy logic
- simple_test_strategy: A test strategy for UI development
- ipc_ui_server: The standalone server for IPC strategy monitoring
- eai_prediction_provider: Prediction provider for EAI V2 API
"""

from __future__ import annotations

__all__ = [
    "IPCStrategy",
    "SimpleTestStrategy",
    "IPCUIServer",
    "EAIPredictionProvider",
]
