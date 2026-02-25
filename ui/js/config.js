/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */

/**
 * Static configuration settings for the application.
 */
export const config = {
  // General settings
  currentInterval: 300, // Default: 5 minutes (in seconds)
  predictionTimeframe: '1', // Default: 1 hour (in hours)
  predictionVersion: 'V2', // Default model version
  symbol: 'BTCUSDT',
  apiSymbol: 'BTC', // Symbol used in custom prediction API
  barCount: 1000, // Default number of bars to display

  // UI default settings
  uiDefaults: {
    timeDisplayMode: 'UTC', // 'Local' or 'UTC' or 'NY'
    interval: 300, // 5 minutes (in seconds)
    timeframe: '1', // 1 hour
    version: 'V2', // Default model version
    verboseTooltip: false, // Default to showing the full tooltip
    forceBarAlignment: true, // Whether to align timestamps to interval boundaries
    showPredictedLine: true, // Whether to show the predicted price line
    onePredictionPerBar: true, // Whether to filter predictions for first in bar
    defaultStrategy: 'None' // Default strategy to auto-select (case-insensitive partial match)
  },

  // Chart series colors and styles
  chartColors: {
    predictedDots: 'rgb(0, 234, 255)',
    predictionPrice: 'rgba(255, 255, 0, 1)',
    predictionPriceLine: 'rgba(0, 183, 255, 1)',
    mapeCalcLine: 'rgb(255, 192, 203)',
    mapeLastKnownLine: 'rgb(255, 105, 180)',
    binancePricePredictedPoints: 'rgb(115, 255, 0)',
    binancePricePredictionPoints: 'rgba(255, 255, 0, 1)',
    blueDotSeries: 'rgba(255, 255, 0, 1)',
    closePriceSeries: 'white'
  },

  // API endpoints
  localApiBase: `${window.location.protocol}//${window.location.hostname}:${window.location.port}/api`,
  predictionWsUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:${window.location.port}/ws`,

  // Chart settings
  confidenceMultiplier: 0.00025, // 0.025%
  reconnectDelay: 5000, // ms

  // Strategy health monitoring timeouts (all in milliseconds)
  strategy: {
    heartbeatStalenessThreshold: 7000,  // 7s - Mark strategy as stale if no heartbeat (just over 1 heartbeat @ 5s)
  },

  // OpenTelemetry configuration
  otel: {
    serviceName: 'web-ui',
    environment: 'development', // 'development', 'staging', 'production'
    otlpTracesUrl: './v1/traces',
    otlpLogsUrl: './v1/logs',
    enableOtel: true,
    batchSize: 1,
    flushIntervalMs: 100,
  },

};
