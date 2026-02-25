/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { state, logger } from './state.js';
import { config } from './config.js';
import { ChartManager } from './ChartManager.js';

/**
 * Manages fetching and processing of candlestick data (both historical and live).
 */
export const CandleDataManager = {
  /**
   * Validates that candle data is in strictly ascending time order (no duplicates).
   * Logs a warning if data is out of order or has duplicates (common with DST transitions).
   * @param {Array<Object>} candles - Array of candle objects with time property
   * @param {string} context - Context string for logging
   * @returns {boolean} True if data is properly ordered, false otherwise
   */
  _validateCandleOrder(candles, context = 'unknown') {
    if (!Array.isArray(candles) || candles.length <= 1) {
      return true; // Empty or single candle is always valid
    }

    for (let i = 1; i < candles.length; i++) {
      const prevTime = candles[i - 1].time;
      const currTime = candles[i].time;

      if (currTime <= prevTime) {
        const isDuplicate = currTime === prevTime;
        logger.warning("Candle data not in strictly ascending time order", {
          ctx: ['CandleData', 'Validation'],
          context,
          index: i,
          prevTime,
          currTime,
          timeMode: state.timeDisplayMode,
          isDuplicate,
          message: isDuplicate
            ? 'Duplicate timestamps found - likely DST "fall back" transition'
            : 'Data misordered - likely DST transition with incorrect offset order'
        });
        return false;
      }
    }

    return true;
  },
  /**
   * Fetches historical candlestick data from the Binance API based on the current interval.
   * Updates the chart and initializes the live candle based on recent trades.
   * @param {number} [endTime=null] - Optional end time for fetching older candles (for pagination)
   * @param {boolean} [appendData=false] - Whether to append the fetched data to existing candles
   * @returns {Promise<{candles: import('./state.js').CandlestickData[], lastCandleTime: number | null, currentBaseTime: number | null, oldestCandleTime: number | null}>}
   */
  async fetchHistorical(endTime = null, appendData = false) {
    try {
      const intervalMap = { 10: '1m', 60: '1m', 300: '5m', 900: '15m', 3600: '1h' };
      const binanceInterval = intervalMap[config.currentInterval] || '1m';

      // Build URL to fetch from our backend proxy
      let url = `/api/binance-klines?symbol=${config.symbol}&interval=${binanceInterval}&limit=${config.barCount}`;
      if (endTime) {
        // Convert seconds to milliseconds for Binance API
        url += `&endTime=${endTime * 1000}`;
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error fetching candles: ${res.status}`);
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        return {
          candles: [],
          lastCandleTime: null,
          currentBaseTime: null,
          oldestCandleTime: null
        };
      }

      let candles = data.map(d => ({
        time: d[0] / 1000,
        open: +d[1],
        high: +d[2],
        low: +d[3],
        close: +d[4]
      }));

      const now = Math.floor(Date.now() / 1000);
      const currentBaseTime = now - (now % config.currentInterval);

      // Store the oldest candle time for pagination reference
      const oldestCandleTime = candles[0]?.time || null;

      // If we're not appending data (i.e., initial load), handle the potentially incomplete latest candle
      if (!appendData) {
        // Remove the potentially incomplete latest candle from historical data
        const lastHistoricalCandle = candles[candles.length - 1];
        if (lastHistoricalCandle && lastHistoricalCandle.time >= currentBaseTime) {
          candles = candles.slice(0, -1);
        }

        // Validate candle order before updating chart (helps detect DST-related issues)
        this._validateCandleOrder(candles, 'initial load');

        ChartManager.updateCandleSeries(candles);
        const lastCompleteCandleTime = candles[candles.length - 1]?.time;
        state.lastKnownCandleTime = lastCompleteCandleTime || state.lastKnownCandleTime;

        // Initialize live candle based on recent trades if possible
        await this.initializeLiveCandle(currentBaseTime);
      } else {
        // If appending data, merge with existing candles
        const existingCandles = state.candleSeries?.data() || [];

        // Combine the arrays and update the chart
        // Note: We prepend the new (older) candles to the existing ones
        const combinedCandles = [...candles, ...existingCandles];

        // Validate candle order before updating chart (helps detect DST-related issues)
        this._validateCandleOrder(combinedCandles, 'append data');

        ChartManager.updateCandleSeries(combinedCandles);

        // Update candles reference to include all data
        candles = combinedCandles;
      }

      // Mark historical data as loaded so live candle updates can proceed
      state.historicalDataLoaded = true;

      return {
        candles,
        lastCandleTime: state.lastKnownCandleTime,
        currentBaseTime,
        oldestCandleTime
      };

    } catch (err) {
      logger.error("Error loading historical candles", { ctx: ['CandleData', 'Server'], error: err.message });
      return { candles: [], lastCandleTime: null, currentBaseTime: null, oldestCandleTime: null };
    }
  },

  /**
   * Initializes the `liveCandle` state based on recent aggregated trades from Binance
   * for the specified `currentBaseTime`.
   * @param {number} currentBaseTime - The UNIX timestamp (seconds) for the start of the current candle interval.
   */
  async initializeLiveCandle(currentBaseTime) {
    try {
      const startTimeMs = currentBaseTime * 1000;
      let url = `/api/binance-aggTrades?symbol=${config.symbol}&startTime=${startTimeMs}&limit=100`;
      const aggTradeRes = await fetch(url);
      if (!aggTradeRes.ok) {
        logger.error("Failed to fetch recent aggregated trades for live candle init", { ctx: ['CandleData', 'Server'], status: aggTradeRes.status });
        return;
      }
      const aggTrades = await aggTradeRes.json();

      if (Array.isArray(aggTrades) && aggTrades.length > 0) {
        const prices = aggTrades.map(t => parseFloat(t.p));
        state.liveCandle = {
          time: currentBaseTime,
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1]
        };
        ChartManager.updateSingleCandle(state.liveCandle);
        state.liveCandleTime = currentBaseTime;
        state.lastKnownCandleTime = currentBaseTime;
      } else {
         state.liveCandleTime = currentBaseTime;
      }
    } catch (err) {
      logger.error("Error initializing live candle from trades", { ctx: ['CandleData', 'Server'], error: err.message });
       state.liveCandleTime = currentBaseTime;
    }
  },

  /**
   * Processes a live trade message from the WebSocket.
   * Updates the `liveCandle` state or creates a new one if the interval has changed.
   * Updates the chart via `ChartManager`.
   * @param {object} trade - The trade data object from the WebSocket message.
   */
  handleTradeMessage(trade) {
    // Skip live candle updates until historical data is loaded
    // This prevents a single live candle from briefly appearing before historical data
    if (!state.historicalDataLoaded) {
      return;
    }

    const price = +trade.p;
    const t = Math.floor(trade.T / 1000);
    const baseTime = t - (t % config.currentInterval);

    // If this trade belongs to a new candle interval
    if (!state.liveCandle || baseTime > state.liveCandleTime) {
      // Start a new live candle
      state.liveCandle = {
        time: baseTime,
        open: price,
        high: price,
        low: price,
        close: price
      };
      state.liveCandleTime = baseTime;
      state.lastKnownCandleTime = baseTime; // Update last known time
      ChartManager.updateSingleCandle(state.liveCandle);
    }
    // If this trade belongs to the current live candle interval
    else if (baseTime === state.liveCandleTime) {
      state.liveCandle.high = Math.max(state.liveCandle.high, price);
      state.liveCandle.low = Math.min(state.liveCandle.low, price);
      state.liveCandle.close = price;
      // Update the candle on the chart in real-time
      ChartManager.updateSingleCandle(state.liveCandle);
    }
  },

  /**
   * Resets the live candle state variables.
   */
  resetState() {
    state.liveCandle = null;
    state.liveCandleTime = null;
    state.historicalDataLoaded = false; // Defer live candle updates until new historical data loads
    // Keep lastKnownCandleTime until new historical data provides a more recent one
  },

  /**
   * Loads more historical candles by fetching older data using pagination.
   * @returns {Promise<boolean>} - Whether more data was successfully loaded
   */
  async loadMoreCandles() {
    try {
      const existingCandles = state.candleSeries?.data() || [];
      if (!existingCandles.length) {
        return false;
      }

      const oldestCandle = existingCandles[0];
      if (!oldestCandle || !oldestCandle.time) {
        return false;
      }

      const endTime = oldestCandle.time - 1;
      const result = await this.fetchHistorical(endTime, true);

      if (!result.candles.length || result.candles.length <= existingCandles.length) {
        return false;
      }

      return true;
    } catch (err) {
      logger.error("Error loading more historical candles", { ctx: ['CandleData', 'Server'], error: err.message });
      return false;
    }
  }
};
