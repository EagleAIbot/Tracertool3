/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { config } from './config.js';
import { BrowserLogger } from './utils/LogWrap.js';
import { getOTelManager } from './OTelManager.js';

// Centralized service configuration - use config.js values
export const SERVICE_NAME = config.otel.serviceName;
export const ENVIRONMENT = config.otel.environment;

// Shared logger for all web-ui modules
export const logger = new BrowserLogger({
  enableOtel: config.otel.enableOtel,
});

// Initialize OTelManager when state.js is imported
// This ensures OTel is available for both tracing and logging
if (config.otel.enableOtel) {
  getOTelManager().catch(error => {
    console.warn('[state] Failed to initialize OTelManager:', error);
  });
}

/**
 * @typedef {import('lightweight-charts').IChartApi} IChartApi
 * @typedef {import('lightweight-charts').ISeriesApi<'Candlestick'>} ICandlestickSeriesApi
 * @typedef {import('lightweight-charts').ISeriesApi<'Line'>} ILineSeriesApi
 * @typedef {import('lightweight-charts').ISeriesApi<'Bar'>} IBarSeriesApi
 * @typedef {import('lightweight-charts').CandlestickData} CandlestickData
 * @typedef {import('lightweight-charts').LineData} LineData
 * @typedef {import('lightweight-charts').BarData} BarData
 * @typedef {import('lightweight-charts').SeriesMarker<Time>} SeriesMarker
 * @typedef {import('lightweight-charts').Time} Time
 */

/**
 * @typedef {Object} PredictionData
 * @property {number} prediction_time The timestamp when the prediction was made
 * @property {number} prediction_price The market price at the time the prediction was made
 * @property {number} predicted_time The timestamp for which the prediction is made
 * @property {number} predicted_price The predicted price at the predicted_time
 * @property {string} prediction_timeframe The timeframe for the prediction, e.g. "1", "2", etc.
 * @property {number} [percentage_difference] The percentage difference between prediction_price and predicted_price
 * @property {Object} [metadata] Additional metadata about the prediction
 */

/**
bar_aligned_predicted_time: 1749592800
binance_trade_id_predicted: 3595068546
binance_trade_id_prediction: 3595026855
binance_trade_price_predicted: 109852.98
binance_trade_price_prediction: 109983.67
binance_trade_time_predicted: "2025-06-10T22:00:15.174000Z"
binance_trade_time_prediction: "2025-06-10T21:00:14.865999Z"
diff_at_predicted_time: -430.1128124999959
diff_at_prediction_time: -31.765293360003852
hours: "1"
id: 470757655871301250
percentage_difference: 0.48115357396627784
predicted_price: 109422.8671875
predicted_time: "2025-06-10T22:00:16.000000Z"
prediction_price: 109951.90470664
prediction_time: "2025-06-10T21:00:16.000000Z"
symbol: "BTC"
version: "V2"
*/


/**
 * Holds the dynamic state of the application, including chart references, data series, and WebSocket status.
 */
export const state = {

  /*********************************************************************
   * Loading State
   *********************************************************************/

  /** @type {boolean} Flag to prevent race conditions during data reload */
  isReloading: false,

  /*********************************************************************
   * Chart objects
   *********************************************************************

  /** @type {IChartApi | null} */
  chart: null,

  /** @type {ICandlestickSeriesApi | null} */
  candleSeries: null,

  /** @type {ILineSeriesApi | null} */
  predictedDots: null,
  v23PredictionLine: null,   // v2.3 shadow prediction line (purple)
  v23LatestData: null,        // latest v2.3 prediction data for tooltip

  /** @type {ILineSeriesApi | null} */
  closePriceSeries: null,

  /** @type {ILineSeriesApi | null} */
  binancePriceLine: null,

  /** @type {ILineSeriesApi | null} */
  mapeLowerLine: null,

  /** @type {ILineSeriesApi | null} */
  mapeUpperLine: null,

  /** @type {ILineSeriesApi | null} */
  blueDotSeries: null,

  /** @type {import('./StopLossLine.js').StopLossLine | null} */
  stopLossLine: null,

  /** @type {import('./TargetLine.js').TargetLine | null} */
  targetLine: null,

  /** @type {import('./TrailingStopActivationLine.js').TrailingStopActivationLine | null} */
  trailingStopActivationLine: null,

  /** @type {Array<SeriesMarker<Time>>} */
  seriesMarkers: [],

  /** @type {Array<SeriesMarker<Time>>} */
  strategyEventMarkers: [],

  /** @type {Map<string, Object>} - Map of marker ID to full event data for tooltips */
  strategyEventData: new Map(),

  /** @type {SeriesMarkersAPI | null} */
  markersAPI: null,

  /** @type {CandlestickData | null} */
  liveCandle: null,

  /** @type {number | null} */
  liveCandleTime: null,

  /** @type {number | null} */
  lastKnownCandleTime: null,

  /** @type {boolean} - Flag to defer live candle updates until historical data loads */
  historicalDataLoaded: false,

  /** @type {number} */
  lastDataUpdate: Date.now(),

  /*********************************************************************
   * Prediction data
   *********************************************************************

  /** @type {Array<PredictionData>} */
  predictions: [],

  /*********************************************************************
   * WebSocket state
   *********************************************************************

  /** @type {WebSocket | null} */
  tradeWS: null,

  /** @type {WebSocket | null} */
  predictionWS: null,

  /** @type {boolean} */
  predictionWsConnected: false,

  /** @type {boolean} */
  tradeWsConnected: false,

  /*********************************************************************
   * UI state
   *********************************************************************

  /** @type {HTMLElement | null} */
  tooltipElement: null,

  /** @type {number | null} */
  lastHoveredPredictionTime: null,

  /** @type {number | null} */
  lastMapeScore: null,

  /** @type {'UTC' | 'Local' | 'US'} */
  timeDisplayMode: 'Local',

  /** @type {string | null} */
  strategyInstanceName: null,

  /** @type {boolean} */
  verboseTooltip: false,

  /** @type {number} */
  lineShiftMinutes: 90,

  /** @type {boolean} */
  showClosePriceLine: false,

  /** @type {boolean} */
  isBinancePriceLineVisible: false,

  /** @type {boolean} */
  isMapeLowerLineVisible: false,

  /** @type {boolean} */
  forceBarAlignment: config.uiDefaults.forceBarAlignment,

  /** @type {boolean} */
  showPredictedLine: config.uiDefaults.showPredictedLine,

  /** @type {number} */
  mapeWindowSize: 20,

  /** @type {Object} */
  currentStrategyHealth: {
    isAlive: false,
    isOrphaned: false,
    lastHeartbeat: null
  },
};
