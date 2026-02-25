/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { config } from './config.js';
import { logger } from './state.js';
import { state } from './state.js';
import { ChartManager } from './ChartManager.js';
import { CandleDataManager } from './CandleDataManager.js';
import { PredictionDataManager } from './PredictionDataManager.js';
import { StrategyDataManager } from './StrategyDataManager.js';
import { WebSocketManager } from './WebSocketManager.js';

/**
 * Manages user interface interactions, primarily handling changes in selectors.
 */
export const UIManager = {
  /**
   * Flag to track if WebSockets have been initialized
   */
  webSocketsInitialized: false,

  /**
   * Flag to track if strategy is currently transitioning to prevent race conditions
   */
  _strategyTransitioning: false,

  /**
   * Track the currently selected strategy to detect re-selection
   */
  _currentStrategy: null,

  /**
   * Initialize UIManager and set global reference
   */
  init() {
    // Set global reference for access from other modules
    window.uiManager = this;
  },

  /**
   * Applies default settings from config to UI elements
   */
  applyDefaultSettings() {
    // Set interval selector
    const intervalSelector = document.getElementById('intervalSelector');
    if (intervalSelector) {
      intervalSelector.value = config.uiDefaults.interval.toString();
      // Also update the config value used by the application
      config.currentInterval = config.uiDefaults.interval;
    }

    // Set timeframe selector
    const timeframeSelector = document.getElementById('timeframeSelector');
    if (timeframeSelector) {
      timeframeSelector.value = config.uiDefaults.timeframe;
      // Also update the config value used by the application
      config.predictionTimeframe = config.uiDefaults.timeframe;
    }

    // Set model version selector
    const modelVersionSelector = document.getElementById('modelVersionSelector');
    if (modelVersionSelector) {
      modelVersionSelector.value = config.uiDefaults.version;
      // Also update the config value used by the application
      config.predictionVersion = config.uiDefaults.version;
    }


    // Set timezone selector
    const timezoneSelector = document.getElementById('timezoneSelector');
    if (timezoneSelector) {
      timezoneSelector.value = config.uiDefaults.timeDisplayMode;
      // Also update the state value used by the application
      state.timeDisplayMode = config.uiDefaults.timeDisplayMode;
      // Apply the timezone setting to the chart
    }

    // Set force bar alignment checkbox
    const forceBarAlignmentCheckbox = document.getElementById('forceBarAlignmentCheckbox');
    if (forceBarAlignmentCheckbox) {
      forceBarAlignmentCheckbox.checked = config.uiDefaults.forceBarAlignment;
      // Also update the state value used by the application
      state.forceBarAlignment = config.uiDefaults.forceBarAlignment;
    }

    // Set show predicted line checkbox
    const showPredictedLineCheckbox = document.getElementById('showPredictedLineCheckbox');
    if (showPredictedLineCheckbox) {
      showPredictedLineCheckbox.checked = config.uiDefaults.showPredictedLine;
      // Also update the state value used by the application
      state.showPredictedLine = config.uiDefaults.showPredictedLine;
    }
  },

  /**
   * Sets up event listeners for the interval, timeframe, model version, bar count, timezone selectors,
   * and the load more button. Triggers `reloadData` when a selection changes.
   */
  async initializeStrategySelector() {
    try {
        const instances = await StrategyDataManager.fetchStrategyInstances();
        const selector = document.getElementById('strategySelector');
        if (!selector) return;

        // Clear previous options but keep the 'None' option
        selector.innerHTML = '<option value="">None</option>';

        let defaultStrategyFound = false;
        const defaultStrategy = config.uiDefaults.defaultStrategy?.toLowerCase();

        instances.forEach(instanceName => {
            const option = document.createElement('option');
            option.value = instanceName;
            option.textContent = instanceName;
            selector.appendChild(option);

            // Check if this matches the default strategy (case-insensitive partial match)
            if (defaultStrategy && instanceName.toLowerCase().includes(defaultStrategy)) {
                defaultStrategyFound = true;
                option.selected = true;
                state.strategyInstanceName = instanceName;
            }
        });

        // If default strategy was selected, load its events
        if (defaultStrategyFound) {
            // Delay triggering the strategy change event to ensure candle data is loaded
            setTimeout(() => {
                const changeEvent = new Event('change');
                selector.dispatchEvent(changeEvent);
            }, 500);
        }
    } catch (error) {
        logger.error("Error initializing strategy selector", { ctx: ['UI', 'Strategy'], error: error.message });
    }
  },

  /**
   * Restores the selected strategy from session storage after browser refresh.
   */
  restoreSession() {
    const savedStrategy = sessionStorage.getItem('selectedStrategy');
    if (savedStrategy) {
      const selector = document.getElementById('strategySelector');
      if (selector) {
        selector.value = savedStrategy;
        state.strategyInstanceName = savedStrategy;

        setTimeout(() => {
          const changeEvent = new Event('change');
          selector.dispatchEvent(changeEvent);
        }, 100);
      }
    }
  },

  setupEventListeners() {
    this.initializeStrategySelector(); // Populate the dropdown on load

    document.getElementById('strategySelector')?.addEventListener('change', async (e) => {
      state.strategyInstanceName = e.target.value;

      // Save selection for browser refresh
      if (state.strategyInstanceName) {
        sessionStorage.setItem('selectedStrategy', state.strategyInstanceName);
      } else {
        sessionStorage.removeItem('selectedStrategy');
      }

      // Clear markers if 'None' is selected
      if (!state.strategyInstanceName) {
        // Stop staleness check when no strategy is selected
        const { StrategyDataManager } = await import('./StrategyDataManager.js');
        StrategyDataManager.stopStalenessCheck();
        ChartManager.clearAllStrategyData();
        return;
      }

      // Only clear if actually switching strategies
      if (this._currentStrategy === state.strategyInstanceName) {
        // Same strategy re-selected, don't clear
        return;
      }

      this._currentStrategy = state.strategyInstanceName;

      // Set transition state to prevent race conditions with live updates
      this._strategyTransitioning = true;

      // Disable the dropdown to prevent user from changing selection during transition
      const strategySelector = document.getElementById('strategySelector');
      if (strategySelector) {
        strategySelector.disabled = true;
        strategySelector.style.cursor = 'not-allowed';
        strategySelector.style.opacity = '0.5';
      }

      try {

        // Clear dead instances tracking when switching strategies
        const { StrategyDataManager } = await import('./StrategyDataManager.js');
        StrategyDataManager._deadInstances.clear();

        // Clear processed event IDs to prevent duplicate detection across different strategies
        StrategyDataManager.clearProcessedEvents();

        // Clear strategy health state when switching strategies
        state.currentStrategyHealth = {
          isAlive: false,
          isOrphaned: false,
          lastHeartbeat: null
        };

        // Start staleness check for the new strategy
        StrategyDataManager.startStalenessCheck();

        // Clear all strategy lines and markers immediately before fetching new data
        const { ChartManager } = await import('./ChartManager.js');
        ChartManager.clearAllStrategyData();

        const candleData = state.candleSeries?.data() || [];
        if (candleData.length === 0) {
          return;
        }

        const firstCandleTime = candleData[0].time;
        const lastCandleTime = candleData[candleData.length - 1].time;

        // Fetch historic events (strategy lines will come from heartbeats)
        // Only fetch if we have valid time parameters
        if (firstCandleTime && lastCandleTime && state.strategyInstanceName) {
          await StrategyDataManager.fetchHistoricStrategyEvents(firstCandleTime, lastCandleTime, state.strategyInstanceName);

          // Now render markers after strategy events are loaded
          ChartManager.updateAllMarkers();
        }

      } catch (err) {
        logger.error("Error handling strategy selection", { ctx: ['UI', 'Strategy'], error: err.message });
      } finally {
        // Always clear transition state, even if there was an error
        this._strategyTransitioning = false;

        // Re-enable the dropdown
        const strategySelector = document.getElementById('strategySelector');
        if (strategySelector) {
          strategySelector.disabled = false;
          strategySelector.style.cursor = '';
          strategySelector.style.opacity = '';
        }
      }
    });

    document.getElementById('intervalSelector')?.addEventListener('change', (e) => {
      const newInterval = parseInt(e.target.value);
      if (newInterval !== config.currentInterval) {
        config.currentInterval = newInterval;
        this.reloadData(false); // Pass false to indicate no WebSocket restart needed
      }
    });

    document.getElementById('timeframeSelector')?.addEventListener('change', (e) => {
      const newTimeframe = e.target.value;
      if (newTimeframe !== config.predictionTimeframe) {
        config.predictionTimeframe = newTimeframe;
        this.reloadData(false); // No WebSocket restart needed
      }
    });

    document.getElementById('modelVersionSelector')?.addEventListener('change', (e) => {
      const newVersion = e.target.value;
      if (newVersion !== config.predictionVersion) {
        config.predictionVersion = newVersion;
        this.reloadData(false); // No WebSocket restart needed
      }
    });



    // Add event listener for MAPE window size dropdown
    document.getElementById('mapeWindowSize')?.addEventListener('change', (e) => {
      const windowSize = parseInt(e.target.value, 10);

      if (windowSize !== state.mapeWindowSize) {
        state.mapeWindowSize = windowSize;

        this.recalculateMapeOnly();

      }
    });



    document.getElementById('timezoneSelector')?.addEventListener('change', (e) => {
      const newTimezone = e.target.value;
      if (newTimezone !== state.timeDisplayMode) {
        state.timeDisplayMode = newTimezone;

        // Reload all state when timezone changes, similar to interval switching
        this.reloadData(false);
      }
    });

    // Add event listener for prediction price line checkbox
    document.getElementById('showPredictionPriceLineCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      ChartManager.togglePredictionPriceLine(isChecked);
    });

    // Add event listener for dim candles checkbox
    document.getElementById('dimCandlesCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      ChartManager.toggleCandlestickOpacity(isChecked);
    });

    // Add event listener for force bar alignment checkbox
    document.getElementById('forceBarAlignmentCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      state.forceBarAlignment = isChecked;
      // Reload data to apply the new alignment setting
      this.reloadData(false);
    });

    // Add event listener for Binance price line checkbox
    document.getElementById('showBinancePriceLineCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      ChartManager.toggleBinancePriceLine(isChecked);
    });

    // Add event listener for MAPE checkbox
    document.getElementById('showMapeLowerCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      state.isMapeLowerLineVisible = isChecked;
      ChartManager.toggleMapeLines(isChecked);
    });

    // Add event listener for Show predicted line checkbox
    document.getElementById('showPredictedLineCheckbox')?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      state.showPredictedLine = isChecked;
      ChartManager.togglePredictedLine(isChecked);
    });

    // Add event listener for line shift input
    document.getElementById('lineShiftInput')?.addEventListener('change', (e) => {
      const newShiftMinutes = parseInt(e.target.value);
      if (!isNaN(newShiftMinutes) && newShiftMinutes !== state.lineShiftMinutes) {
        state.lineShiftMinutes = newShiftMinutes;
        ChartManager.refreshClosePriceSeries(); // Refresh the chart with the new shift
      }
    });

    const showClosePriceLineCheckbox = document.getElementById('showClosePriceLineCheckbox');
    if (showClosePriceLineCheckbox) {
      showClosePriceLineCheckbox.checked = state.showClosePriceLine;
      showClosePriceLineCheckbox.addEventListener('change', (e) => {
        state.showClosePriceLine = e.target.checked;
        ChartManager.toggleClosePriceLineVisibility(state.showClosePriceLine);
      });
    }

    // Initialize force bar alignment checkbox
    const forceBarAlignmentCheckbox = document.getElementById('forceBarAlignmentCheckbox');
    if (forceBarAlignmentCheckbox) {
      forceBarAlignmentCheckbox.checked = state.forceBarAlignment;
    }

    // Add event listener for Use Standard Predictions checkbox
    document.getElementById('useStandardPredictionsCheckbox')?.addEventListener('change', async (e) => {
      const isChecked = e.target.checked;
      state.useStandardPredictions = isChecked;

      // Send setting to server
      try {
        const response = await fetch(`${config.localApiBase}/set-prediction-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ useStandard: isChecked })
        });
        if (response.ok) {
          logger.info(`Prediction mode set to: ${isChecked ? 'Standard' : 'Enriched'}`);
          // Reload data to get predictions in new format
          this.reloadData(false);
        }
      } catch (err) {
        logger.error('Failed to set prediction mode', { error: err.message });
      }
    });

    // Add event listener for verbose tooltip checkbox
    document.getElementById('verboseTooltipCheckbox')?.addEventListener('change', (e) => {
      state.verboseTooltip = e.target.checked;
    });

    // Add event listener for the Load More button
    const loadMoreButton = document.getElementById('loadMoreButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadMoreButton && loadingIndicator) {
      loadMoreButton.addEventListener('click', async () => {
        try {
          // Show loading indicator and disable the button
          loadingIndicator.style.display = 'block';
          loadMoreButton.disabled = true;

          // --- THIS IS THE FIX ---
          // 1. Clear all existing prediction data and visuals FIRST to prevent a state desync.
          PredictionDataManager.resetState(); // Clears prediction data array
          ChartManager.updatePredictionVisuals({ // Clears prediction series from the chart
              predictedPricePoints: [],
              predictionPricePoints: [],
              binancePricePredictedPoints: [],
              mapeLowerPoints: [],
              mapeUpperPoints: []
          });

          // 2. Now, load and append the older candles. The chart will redraw with only candles.
          const success = await CandleDataManager.loadMoreCandles();

          if (success) {
            // 3. Get the new, full time range of all displayed candles.
            const candleData = state.candleSeries?.data() || [];
            const firstCandleTime = candleData.length > 0 ? candleData[0].time : null;
            const lastCandleTime = candleData.length > 0 ? candleData[candleData.length - 1].time : null;

            // 4. Fetch and redraw all predictions for the complete, new time range.
            await PredictionDataManager.fetchHistorical(firstCandleTime, lastCandleTime);

            // 5. Fit the chart to show all the new content.
            if (window.chart && window.chart.timeScale) {
              window.chart.timeScale().fitContent();
            }
          }

        } catch (err) {
          logger.error("Error loading more historical data", { ctx: ['UI', 'LoadMore'], error: err.message });
        } finally {
          // Hide loading indicator and re-enable button
          loadingIndicator.style.display = 'none';
          loadMoreButton.disabled = false;
        }
      });
    }
    // Initialize WebSockets once at startup if not already done
    if (!this.webSocketsInitialized) {
      WebSocketManager.startPrediction();
      this.webSocketsInitialized = true;
    }

    // Restore session after all event listeners are set up
    this.restoreSession();
  },

  /**
   * Efficiently recalculates and redraws only the MAPE lines without a full data reload.
   */
  recalculateMapeOnly() {
    // 1. Reprocess the scores on existing data in memory.
    const reprocessedPredictions = PredictionDataManager.reprocessMapeScores();

    // 2. Update only the MAPE series on the chart with the new data.
    ChartManager.updateMapeSeries(reprocessedPredictions);
  },

  /**
   * Orchestrates the process of reloading all data in proper sequence.
   * Ensures each layer completes before the next begins to prevent rendering race conditions.
   * Optionally stops/restarts WebSockets based on restartSockets parameter.
   *
   * Sequence: Candles → Predictions → Strategy Events → [Single Marker Update]
   *
   * @param {boolean} restartSockets - Whether to restart WebSockets (default: false)
   */
  async reloadData(restartSockets = false) {
    // Set flag to prevent WebSocket predictions from being added during reload
    state.isReloading = true;

    try {
      // Only stop WebSockets if explicitly requested
      if (restartSockets) {
        // 1. Stop existing WebSockets to prevent race conditions
        WebSocketManager.stopPrediction(); // Stops and prevents auto-reconnect
      }

      // 2. Clear chart series and state
      ChartManager.resetSeriesData();
      CandleDataManager.resetState();
      PredictionDataManager.resetState();

      // 3. Clear markers immediately to prevent old markers showing during reload
      state.seriesMarkers = [];
      state.strategyEventMarkers = [];
      if (state.candleSeries) {
        state.markersAPI?.setMarkers([]);
      }

      // === LAYER 1: CANDLES (base coordinate system) ===
      // Wait for candles to fully load - everything else depends on this
      const { lastCandleTime } = await CandleDataManager.fetchHistorical();

      const candleData = state.candleSeries?.data() ?? [];
      const firstCandleTime = candleData.length > 0 ? candleData[0].time : null;

      if (!firstCandleTime || !lastCandleTime) {
        // No candle data available, can't proceed with other data
        logger.debug("No candle data available, skipping dependent data loads", { ctx: ['UI', 'Reload'] });
        return;
      }

      // === LAYER 2: PREDICTIONS (depends on candle coordinate system) ===
      // Load predictions but don't draw markers yet
      await PredictionDataManager.fetchHistorical(firstCandleTime, lastCandleTime);

      // === LAYER 3: STRATEGY EVENTS (depends on candle coordinate system) ===
      // Load strategy events but don't draw markers yet
      if (state.strategyInstanceName) {
        await StrategyDataManager.fetchHistoricStrategyEvents(firstCandleTime, lastCandleTime, state.strategyInstanceName);
      }

      // === LAYER 4: MARKERS (combines prediction + strategy markers) ===
      // NOW render all markers in one batch with stable coordinate system
      ChartManager.updateAllMarkers();

      // === LAYER 5: STRATEGY LINES (from live heartbeats) ===
      // Strategy lines will be populated from heartbeat WebSocket messages
      // They don't depend on historic data loading

      // 6. Only restart WebSockets if they were stopped
      if (restartSockets) {
        WebSocketManager.startPrediction(); // Restarts with reconnect logic enabled
        this.webSocketsInitialized = true;
      }
    } finally {
      // Always clear the reload flag, even if an error occurred
      state.isReloading = false;
    }
  }
};
