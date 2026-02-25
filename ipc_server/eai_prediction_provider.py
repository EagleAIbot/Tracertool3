# © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
#
# This software and its source code are proprietary and confidential.
# Unauthorized copying, distribution, or modification of this file, in
# whole or in part, without the express written permission of
# Cayman Sunsets Holidays Ltd is strictly prohibited.
"""
EAI Prediction Provider

Provides helper methods for querying predictions from ClickHouse.
Manages its own ClickHouse connection using clickhouse-connect library.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd

# Use clickhouse-connect directly instead of external wrapper
try:
    import clickhouse_connect
    HAS_CLICKHOUSE = True
except ImportError:
    HAS_CLICKHOUSE = False
    print("⚠️  clickhouse-connect not installed. Run: pip install clickhouse-connect")


class EAIPredictionProvider:
    """
    Provider for EAI predictions from ClickHouse.

    Features:
    - Query standard predictions (no enrichment)
    - Query enriched predictions (with Binance trade data)
    - Clean interface with consistent datetime formatting
    - Manages its own ClickHouse connection
    """

    def __init__(
        self,
        clickhouse_host: str = "localhost",
        clickhouse_port: int = 9100,
        clickhouse_user: str = "default",
        clickhouse_password: str = "",
        clickhouse_database: str = "default",
    ):
        """
        Initialize EAI Prediction Provider.

        Args:
            clickhouse_host: ClickHouse host
            clickhouse_port: ClickHouse port (default: 9100 for native protocol)
            clickhouse_user: ClickHouse username
            clickhouse_password: ClickHouse password
            clickhouse_database: ClickHouse database
        """
        if not HAS_CLICKHOUSE:
            raise ImportError("clickhouse-connect is required. Run: pip install clickhouse-connect")

        self.clickhouse_client = clickhouse_connect.get_client(
            host=clickhouse_host,
            port=clickhouse_port,
            username=clickhouse_user,
            password=clickhouse_password,
            database=clickhouse_database,
        )
        self.database = clickhouse_database

    # ============================================
    # PREDICTION QUERY METHODS
    # ============================================

    def get_standard_predictions(
        self,
        start_time_str: str,
        end_time_str: str,
        version: str,
        symbol: str,
        timeframe: str,
    ) -> list[dict[str, Any]]:
        """
        Query standard predictions from eai_api_predictions table (no enrichment).

        This method uses ClickHouseClientWrapper's execute_to_dataframe for proper
        datetime formatting, matching the enriched predictions format.

        Args:
            start_time_str: Start time in ISO format (e.g., '2025-10-18T19:26:27Z')
            end_time_str: End time in ISO format
            version: Prediction model version (e.g., 'V2')
            symbol: Trading symbol (e.g., 'BTC')
            timeframe: Timeframe (e.g., '1', '2', '4')

        Returns:
            List of prediction dictionaries with standard fields only
        """
        try:
            # Convert ISO strings to datetime objects for ClickHouse
            start_time_dt = datetime.fromisoformat(start_time_str.replace("Z", "+00:00"))
            end_time_dt = datetime.fromisoformat(end_time_str.replace("Z", "+00:00"))

            # Query eai_api_predictions table directly (no enrichment join)
            query = """
                SELECT
                    toString(id) as id,
                    version,
                    symbol,
                    hours,
                    prediction_time,
                    prediction_price,
                    predicted_time,
                    predicted_price
                FROM eai_api_predictions
                WHERE version = %(version)s
                  AND symbol = %(symbol)s
                  AND hours = %(hours)s
                  AND prediction_time >= %(start_time)s
                  AND prediction_time <= %(end_time)s
                ORDER BY prediction_time ASC
            """

            params = {
                "version": version,
                "symbol": symbol,
                "hours": timeframe,
                "start_time": start_time_dt,
                "end_time": end_time_dt,
            }

            # Execute query using clickhouse-connect's query_df method
            df = self.clickhouse_client.query_df(query, parameters=params)

            if df is None or df.empty:
                return []

            # Convert datetime columns to RFC3339/ISO8601 UTC strings (matching enriched predictions)
            datetime_cols = ["prediction_time", "predicted_time"]
            for col in datetime_cols:
                if col in df.columns:
                    df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
                    df[col] = df[col].dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                    df[col] = df[col].replace("NaT", None)

            # Convert DataFrame to list of dicts
            predictions = df.to_dict("records")

            return predictions

        except Exception as e:
            print(f"Error querying standard predictions: {e}")
            return []

    def get_enriched_predictions(
        self,
        start_time_str: str,
        end_time_str: str,
        version: str,
        symbol: str,
        timeframe: str,
    ) -> list[dict[str, Any]]:
        """
        Query enriched predictions (standard predictions + Binance enrichment data).

        Note: Enrichment requires external data pipeline. Falls back to standard predictions.

        Args:
            start_time_str: Start time in ISO format
            end_time_str: End time in ISO format
            version: Prediction model version (e.g., 'V2')
            symbol: Trading symbol (e.g., 'BTC')
            timeframe: Timeframe (e.g., '1', '2', '4')

        Returns:
            List of prediction dictionaries
        """
        # Fall back to standard predictions (enrichment requires external data pipeline)
        return self.get_standard_predictions(
            start_time_str,
            end_time_str,
            version,
            symbol,
            timeframe,
        )

    def close(self) -> None:
        """Close ClickHouse connection."""
        if self.clickhouse_client:
            self.clickhouse_client.close()


# ============================================
# REMOVED: Methods no longer needed
# ============================================
# The following methods have been removed:
# - get_historical_predictions() - Replaced by get_standard_predictions/get_enriched_predictions
# - get_latest_prediction() - Replaced by get_standard_predictions with appropriate time range
# - close() - No longer needed (stateless, no client to close)
# - login() - EAI API authentication (removed in previous refactor)
# - fetch_prediction() - Fetch single prediction from API (removed in previous refactor)
# - poll_predictions() - Poll API for new predictions (removed in previous refactor)
# - _store_prediction() - Store prediction in ClickHouse (removed in previous refactor)
# - start() - Start polling task (removed in previous refactor)
# - stop() - Stop polling task (removed in previous refactor)
#
# For real-time prediction collection, use a separate service that writes to ClickHouse.
# This provider is now a stateless utility for querying predictions.
