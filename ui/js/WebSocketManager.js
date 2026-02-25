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
import { CandleDataManager } from './CandleDataManager.js';
import { PredictionDataManager } from './PredictionDataManager.js';
import { StrategyDataManager } from './StrategyDataManager.js';
import { IndicatorManager } from './IndicatorManager.js';
import { startActiveSpanFromTraceparent } from './tracing.js';

/**
 * Manages WebSocket connections for live trade and prediction data.
 */
export const WebSocketManager = {

  /**
   * Establishes the WebSocket connection for live prediction data from the local server.
   * Sets up event handlers and includes reconnection logic on close.
   */
  startPrediction() {

    if (state.predictionWS && state.predictionWS.readyState === WebSocket.OPEN) {
      return;
    }

    if (state.predictionWS) { // Clean up old socket if exists
      state.predictionWS.onclose = null; // Prevent reconnect attempts from old socket
      state.predictionWS.onopen = null;
      state.predictionWS.onmessage = null;
      state.predictionWS.onerror = null;

      try {
        state.predictionWS.close();
      } catch (e) {
        logger.error('Error closing prediction WebSocket', { ctx: ['WebSocket', 'Cleanup'], error: e.message });
      }

      state.predictionWS = null;
    }

    logger.info('Connecting to prediction WebSocket', { ctx: ['WebSocket', 'Connection'], url: config.predictionWsUrl });

    try {
      state.predictionWS = new WebSocket(config.predictionWsUrl);
      window.predictionWS = state.predictionWS; // Keep global ref if needed elsewhere

      state.predictionWS.onopen = () => {
        logger.info('WebSocket connection established', { ctx: ['WebSocket', 'Server', 'Connected'] });
        state.predictionWsConnected = true;
      };

      state.predictionWS.onmessage = async (msg) => {
        try {
          const message = JSON.parse(msg.data);

          if (message.type === 'trade') {
            CandleDataManager.handleTradeMessage(message.data);
          } else {
            await startActiveSpanFromTraceparent(
              `websocket.${message.type}`,
              async function handleWebSocketMessage() {
                if (message.type === 'prediction') {
                  PredictionDataManager.handlePredictionMessage(message.data);
                  // Check if prediction matches armed strategy filters
                  WebSocketManager.checkSignalAgainstFilters(message.data);
                } else if (message.type === 'prediction_v23') {
                  // v2.3 shadow model prediction — show in overlay panel
                  WebSocketManager.handleV23Prediction(message.data);
                } else if (message.type === 'strategy_event') {
                  StrategyDataManager.handleStrategyEvent(message.data);
                } else if (message.type === 'strategy_lines') {
                  StrategyDataManager.handleStrategyLines(message.data);
                } else if (message.type === 'strategy_heartbeat') {
                  StrategyDataManager.handleStrategyHeartbeat(message.data);
                } else if (message.type === 'simulation_status') {
                  if (window.simulationManager) {
                    window.simulationManager.updateSimulationStatus(message);
                  }
                } else if (message.type === 'pong') {
                  // Silent - no logging needed for pong
                } else {
                  logger.warning('Received unknown message type', { message });
                }
              },
            message.trace_context);
          }
        } catch (e) {
          logger.exception('WebSocket message parsing error', e);
        }
      };

      state.predictionWS.onerror = (err) => {
        logger.error('WebSocket connection error', { error: err });
        state.predictionWsConnected = false;
      };

      state.predictionWS.onclose = (event) => {
        logger.warning('WebSocket connection closed', { code: event.code, reason: event.reason });
        state.predictionWsConnected = false;

        // Implement reconnection logic
        setTimeout(() => this.startPrediction(), config.reconnectDelay || 5000);
      

  /**
   * Handle v2.3 shadow model prediction
   */
  handleV23Prediction(data) {
    window.latestV23Prediction = data;

    // Draw purple price prediction lines on chart
    if (window.ChartManager || typeof ChartManager !== 'undefined') {
      try {
        ChartManager.updateV23Lines(data);
      } catch(e) {}
    }


    const panel = document.getElementById("v23-prediction-panel");
    if (!panel) return;

    const dir = data.direction || "NEUTRAL";
    const conf = data.confidence || 0;
    const p1h = data.direction_1h || 0.5;
    const p2h = data.direction_2h || 0.5;
    const p4h = data.direction_4h || 0.5;
    const price = data.current_price || 0;

    const dirColor = dir === "LONG" ? "#00ff88" : dir === "SHORT" ? "#ff4444" : "#888";
    const ts = data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "--";


    const currentPrice = data.current_price || 0;
    const calcTarget = (prob, mag) => {
      const sign = prob >= 0.5 ? 1 : -1;
      return (currentPrice * (1 + sign * Math.abs(mag || 0) / 100)).toFixed(0);
    };
    const t1h = calcTarget(data.direction_1h || 0.5, data.magnitude_1h || 0);
    const t2h = calcTarget(data.direction_2h || 0.5, data.magnitude_2h || 0);
    const t4h = calcTarget(data.direction_4h || 0.5, data.magnitude_4h || 0);

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;border-bottom:1px solid #333;padding-bottom:4px;">
        <span style="font-size:10px;color:#a855f7;font-weight:bold;letter-spacing:1px;">v2.3 SHADOW</span>
        <span style="font-size:9px;color:#666;">${ts}${data.is_backfill ? " BF" : " LIVE"}</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
        <span style="font-size:16px;font-weight:bold;color:${dirColor}">${dir}</span>
        <span style="font-size:11px;color:${conf>=0.5?"#00ff88":"#888"}">${(conf*100).toFixed(0)}% conf</span>
        <span style="font-size:10px;color:#666;">$${price.toLocaleString()}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:10px;">
        <div style="background:#1a1a1a;border-radius:3px;padding:3px 5px;text-align:center;">
          <div style="color:#555;font-size:9px;">1H</div>
          <div style="color:${p1h>=0.55?"#00ff88":p1h<=0.45?"#ff4444":"#888"};font-weight:bold;">${(p1h*100).toFixed(0)}%↑</div>
        </div>
        <div style="background:#1a1a1a;border-radius:3px;padding:3px 5px;text-align:center;">
          <div style="color:#555;font-size:9px;">2H</div>
          <div style="color:${p2h>=0.55?"#00ff88":p2h<=0.45?"#ff4444":"#888"};font-weight:bold;">${(p2h*100).toFixed(0)}%↑</div>
        </div>
        <div style="background:#1a1a1a;border-radius:3px;padding:3px 5px;text-align:center;">
          <div style="color:#555;font-size:9px;">4H</div>
          <div style="color:${p4h>=0.55?"#00ff88":p4h<=0.45?"#ff4444":"#888"};font-weight:bold;">${(p4h*100).toFixed(0)}%↑</div>
        </div>
      </div>
    `;
  },

};
    } catch (error) {
      logger.error('Error creating prediction WebSocket', { error: error.message });
      state.predictionWsConnected = false;

      // Try to reconnect after a delay
      setTimeout(() => this.startPrediction(), config.reconnectDelay || 5000);
    }
  },


  /**
   * Closes the prediction WebSocket connection if it exists and prevents automatic reconnection.
   */
   stopPrediction() {
     if (state.predictionWS) {
       logger.info('Stopping Prediction WebSocket');

       // Clear all event handlers first
       state.predictionWS.onclose = null;
       state.predictionWS.onopen = null;
       state.predictionWS.onmessage = null;
       state.predictionWS.onerror = null;

       try {
         state.predictionWS.close();
       } catch (e) {
         logger.error('Error closing prediction WebSocket', { error: e.message });
       }

       state.predictionWS = null;
       state.predictionWsConnected = false;
     }
   },

  /**
   * Checks incoming prediction against armed strategy filters and triggers alert if matched.
   * Also updates the armed strategy banner with latest prediction info.
   * @param {object} data - The prediction data from WebSocket
   */
  async checkSignalAgainstFilters(data) {
    const prediction = data.latest_prediction;
    if (!prediction) return;

    // Always store latest prediction for display (even if not armed)
    window.latestPrediction = prediction;

    // Check if strategy is armed
    const filters = window.strategyFilters;
    if (!filters || !filters.armed) return;

    // Update the armed strategy info display
    this.updateArmedStrategyInfo(prediction, filters);

    try {
      const predictionPrice = parseFloat(prediction.prediction_price || 0);
      const predictedPrice = parseFloat(prediction.predicted_price || 0);
      const delta = predictedPrice - predictionPrice;
      const absDelta = Math.abs(delta);
      const direction = delta > 0 ? 'LONG' : 'SHORT';

      // Check delta threshold
      if (absDelta < filters.delta) return;

      // Check direction filter
      if (filters.direction !== 'ANY' && filters.direction !== direction) return;

      // Check session filter (NY time)
      const predictionTime = prediction.prediction_time || prediction.predicted_time;
      if (filters.session !== 'ANY' && predictionTime) {
        const nyTime = this.getNYTime(predictionTime);
        const hour = nyTime.getHours();
        const day = nyTime.getDay();

        // Skip weekends
        if (day === 0 || day === 6) return;

        // Session filters (hours in NYC/ET time)
        if (filters.session === 'IPC_MORNING' && (hour < 8 || hour >= 11)) return;
        if (filters.session === 'LATE_MORNING' && (hour < 9 || hour >= 12)) return;
        if (filters.session === 'AFTERNOON' && (hour < 13 || hour >= 16)) return;  // 1-4 PM ET
        if (filters.session === 'FULL_DAY' && (hour < 8 || hour >= 16)) return;
      }

      // Check indicator filter
      if (filters.indicator && filters.indicator !== 'ANY') {
        const indicators = await IndicatorManager.getCurrentIndicators();
        if (!indicators) {
          logger.warning('Could not fetch indicators for filter check', { ctx: ['Strategy', 'Indicator'] });
          return;
        }

        // Check each indicator type
        if (filters.indicator === 'MACD_BULL' && indicators.macdHistogram <= 0) return;
        if (filters.indicator === 'MACD_BEAR' && indicators.macdHistogram >= 0) return;
        if (filters.indicator === 'EMA_BULL' && indicators.ema9 <= indicators.ema21) return;
        if (filters.indicator === 'EMA_BEAR' && indicators.ema9 >= indicators.ema21) return;
        if (filters.indicator === 'RSI_OVERSOLD' && indicators.rsi >= 40) return;
        if (filters.indicator === 'RSI_OVERBOUGHT' && indicators.rsi <= 60) return;
        if (filters.indicator === 'ADX_STRONG' && indicators.adx <= 25) return;

        logger.debug('Indicator filter passed', {
          ctx: ['Strategy', 'Indicator'],
          filter: filters.indicator,
          rsi: indicators.rsi?.toFixed(1),
          macd: indicators.macdHistogram?.toFixed(2),
          ema9: indicators.ema9?.toFixed(0),
          ema21: indicators.ema21?.toFixed(0),
          adx: indicators.adx?.toFixed(1)
        });
      }

      // All filters passed - trigger alert!
      logger.info('🚨 SIGNAL MATCHED!', {
        ctx: ['Strategy', 'Signal'],
        direction,
        delta: absDelta,
        predictionPrice,
        predictedPrice,
        filters
      });

      // Call the alert function in the UI
      if (typeof window.showSignalAlert === 'function') {
        window.showSignalAlert(direction, delta, predictionPrice, predictedPrice);
      }

    } catch (e) {
      logger.error('Error checking signal against filters', { ctx: ['Strategy', 'Filter'], error: e.message });
    }
  },

  /**
   * Converts a timestamp to NY timezone
   * @param {string} timestamp - ISO timestamp
   * @returns {Date} Date in NY timezone
   */
  getNYTime(timestamp) {
    const date = new Date(timestamp);
    // Create a formatter for NY timezone
    const nyFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = nyFormatter.formatToParts(date);
    const getValue = (type) => parseInt(parts.find(p => p.type === type)?.value || '0');
    return new Date(getValue('year'), getValue('month') - 1, getValue('day'), getValue('hour'), getValue('minute'));
  },

  /**
   * Updates the armed strategy info banner with latest prediction and indicator data
   * @param {object} prediction - Latest prediction data
   * @param {object} filters - Current strategy filters
   */
  async updateArmedStrategyInfo(prediction, filters) {
    try {
      const alertDetails = document.getElementById('alertDetails');
      if (!alertDetails) return;

      const predictionPrice = parseFloat(prediction.prediction_price || 0);
      const predictedPrice = parseFloat(prediction.predicted_price || 0);
      const delta = predictedPrice - predictionPrice;
      const absDelta = Math.abs(delta);
      const direction = delta > 0 ? 'LONG' : 'SHORT';

      // Get prediction time in NY
      const predictionTime = prediction.prediction_time || prediction.predicted_time;
      let timeDisplay = '';
      if (predictionTime) {
        const nyTime = this.getNYTime(predictionTime);
        const hours = nyTime.getHours().toString().padStart(2, '0');
        const mins = nyTime.getMinutes().toString().padStart(2, '0');
        timeDisplay = `${hours}:${mins} NYC`;
      }

      // Get current indicators
      const indicators = await IndicatorManager.getCurrentIndicators();

      // Build filter summary line
      const filterParts = [];
      if (filters.direction !== 'ANY') filterParts.push(filters.direction);
      filterParts.push('Δ>' + filters.delta);
      if (filters.indicator !== 'ANY') filterParts.push(filters.indicator.replace('_', ' '));
      if (filters.session !== 'ANY') filterParts.push(filters.session.replace('_', ' '));
      const filterSummary = filterParts.join(' | ');

      // Format indicator display based on what we're filtering for
      let indicatorStatus = '';
      if (filters.indicator && filters.indicator !== 'ANY' && indicators) {
        const indicatorMatch = this.checkIndicatorMatch(filters.indicator, indicators);
        const matchColor = indicatorMatch ? '#00ff88' : '#ff6b6b';
        const matchIcon = indicatorMatch ? '✓' : '✗';

        if (filters.indicator.includes('MACD')) {
          indicatorStatus = `<span style="color: ${matchColor}">${matchIcon} MACD: ${indicators.macdHistogram?.toFixed(1) || 'N/A'}</span>`;
        } else if (filters.indicator.includes('EMA')) {
          indicatorStatus = `<span style="color: ${matchColor}">${matchIcon} EMA9: ${indicators.ema9?.toFixed(0) || 'N/A'} vs EMA21: ${indicators.ema21?.toFixed(0) || 'N/A'}</span>`;
        } else if (filters.indicator.includes('RSI')) {
          indicatorStatus = `<span style="color: ${matchColor}">${matchIcon} RSI: ${indicators.rsi?.toFixed(1) || 'N/A'}</span>`;
        } else if (filters.indicator.includes('ADX')) {
          indicatorStatus = `<span style="color: ${matchColor}">${matchIcon} ADX: ${indicators.adx?.toFixed(1) || 'N/A'}</span>`;
        }
      }

      // Format delta display with color based on direction match
      const deltaMatch = absDelta >= filters.delta;
      const directionMatch = filters.direction === 'ANY' || filters.direction === direction;
      const deltaColor = deltaMatch && directionMatch ? '#00ff88' : '#ff9500';
      const dirColor = direction === 'LONG' ? '#00ff88' : '#ff4444';

      // Build the display
      alertDetails.innerHTML = `
        <div style="margin-bottom: 4px; color: #888;">${filterSummary}</div>
        <div style="font-size: 1.1em;">
          <span style="color: ${dirColor}; font-weight: bold;">${direction}</span>
          <span style="color: ${deltaColor}; margin-left: 8px;">Δ$${absDelta.toFixed(0)}</span>
          <span style="color: #888; margin-left: 8px;">${timeDisplay}</span>
        </div>
        ${indicatorStatus ? `<div style="margin-top: 4px;">${indicatorStatus}</div>` : ''}
      `;
    } catch (e) {
      logger.error('Error updating armed strategy info', { error: e.message });
    }
  },

  /**
   * Check if indicator matches the filter requirement
   */
  checkIndicatorMatch(filter, indicators) {
    if (!indicators) return false;
    if (filter === 'MACD_BULL') return indicators.macdHistogram > 0;
    if (filter === 'MACD_BEAR') return indicators.macdHistogram < 0;
    if (filter === 'EMA_BULL') return indicators.ema9 > indicators.ema21;
    if (filter === 'EMA_BEAR') return indicators.ema9 < indicators.ema21;
    if (filter === 'RSI_OVERSOLD') return indicators.rsi < 40;
    if (filter === 'RSI_OVERBOUGHT') return indicators.rsi > 60;
    if (filter === 'ADX_STRONG') return indicators.adx > 25;
    return true;
  }
};