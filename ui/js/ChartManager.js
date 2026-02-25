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
import { shiftDataToLocalTime, parseTimeToSecondsUTC, toRFC3339FromSeconds, shiftPointToLocalTime, unshiftTimeStampToUtc, shiftTimeStampToLocal } from './utils.js';
import { createStopLossLine, createTargetLine, createTrailingStopActivationLine, createTestPriceLine } from './HorizontalStrategyLine.js';
/**
 * Manages the Lightweight Charts instance and its series.
 */
export const ChartManager = {
  /**
   * Initializes the Lightweight Chart, adds all required series, and configures basic settings.
   */
  initialize() {
    // Destructure all necessary components from the global LightweightCharts object
    const {
      createChart,
      CrosshairMode,
      LineStyle,
      LineSeries,
      CandlestickSeries,
      TickMarkType: ImportedTickMarkType,
    } = window.LightweightCharts;

    // Fallback mapping for UMD build
    const TickMarkType = ImportedTickMarkType ?? {
      Year:            0,  // start of each year
      Month:           1,  // start of each calendar month
      DayOfMonth:      2,  // when the day rolls over
      Time:            3,  // intraday (hours+minutes)
      TimeWithSeconds: 4,  // intraday including seconds
    };

    const chartElement = document.getElementById('chart');

    if (!chartElement) {
      logger.error('Chart element not found!', { ctx: ['Chart', 'Init'] });
      return;
    }

    state.chart = createChart(chartElement, {
      layout: {
        background: { type: 'solid', color: '#000' },
        textColor: '#ccc'
      },
      grid: {
        vertLines: { color: '#333' },
        horzLines: { color: '#333' }
      },
      rightPriceScale: {
        borderColor: '#555'
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          labelVisible: false,
        },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,

        tickMarkFormatter: (time, tickMarkType, locale) => {

          const date = new Date(time * 1000);

          // Determine timezone based on current display mode
          let timeZone = 'UTC';
          if (state.timeDisplayMode === 'Local') {
            timeZone = undefined; // Use browser's local timezone
          } else if (state.timeDisplayMode === 'NY') {
            timeZone = 'America/New_York';
          }

          // Build format options, conditionally including timeZone
          const getOptions = (baseOptions) => {
            if (timeZone === undefined) {
              return baseOptions; // Omit timeZone to use browser local time
            }
            return { ...baseOptions, timeZone };
          };

          switch (tickMarkType) {
            case TickMarkType.DayOfMonth:
              return new Intl.DateTimeFormat(locale, getOptions({ day: '2-digit', month: 'short' })).format(date);
            case TickMarkType.Month:
              return new Intl.DateTimeFormat(locale, getOptions({ day: '2-digit', month: 'short' })).format(date);
            case TickMarkType.Year:
              return new Intl.DateTimeFormat(locale, getOptions({ day: '2-digit', month: 'short', year: 'numeric' })).format(date);
            case TickMarkType.Time:
            default:
              return new Intl.DateTimeFormat(locale, getOptions({ hour: '2-digit', minute: '2-digit', hour12: false })).format(date);
          }
        },
      },
    });

    // V5 UPGRADE: Use the new addSeries API
    state.candleSeries = state.chart.addSeries(CandlestickSeries, {});

    state.candleSeries.applyOptions({
      upColor:        'rgba(38,166,154,0.6)',   // softer teal-green
      downColor:      'rgba(239,83,80,0.6)',    // softer soft-red
      borderUpColor:  'rgba(38,166,154,1)',     // solid border
      borderDownColor:'rgba(239,83,80,1)',
      wickUpColor:    'rgba(38,166,154,1)',
      wickDownColor:  'rgba(239,83,80,1)',
      borderVisible: true
    });

    this.createTooltipElement();
    this.createTimeLabel();

    // V5 UPGRADE: Use the new addSeries API.
    // NOTE: pointMarkersVisible is no longer a valid option. Markers are now a plugin.
    // You will need to add the Series Marker plugin to restore this functionality.
    state.predictedDots = state.chart.addSeries(LineSeries, {
      color: config.chartColors.predictedDots,
      lineWidth: 1,
      lineVisible: true,
      crossHairMarkerVisible: true,
      lastValueVisible: false,
      priceLineVisible: false,
      pointMarkersVisible: true,         // enables dots
      pointMarkersRadius: 1,             // optional: size of the dots
    });

    // V5 UPGRADE: Use the new addSeries API and note that markers are now a plugin.
    state.predictionPriceLine = state.chart.addSeries(LineSeries, {
      color: config.chartColors.predictionPriceLine,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });

    // V5 UPGRADE: Use the new addSeries API and note that markers are now a plugin.
    state.binancePriceLine = state.chart.addSeries(LineSeries, {
      color: config.chartColors.binancePricePredictedPoints,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
      pointMarkersRadius: 1,             // optional: size of the dots
    });

    // V5 UPGRADE: Use the new addSeries API
    state.mapeLowerLine = state.chart.addSeries(LineSeries, {
      color: config.chartColors.mapeCalcLine,
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });

    // V5 UPGRADE: Use the new addSeries API
    state.mapeUpperLine = state.chart.addSeries(LineSeries, {
      color: config.chartColors.mapeCalcLine,
      lineStyle: LineStyle.Dashed,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: false,
    });

    // V5 UPGRADE: Use the new addSeries API and note that markers are now a plugin.
    state.blueDotSeries = state.chart.addSeries(LineSeries, {
      color: config.chartColors.blueDotSeries,
      lineVisible: false,
      crossHairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      pointMarkersVisible: state.showPredictedLine,  // initialize based on state
      pointMarkersRadius: 5,             // optional: size of the dots
    });

    // state.timeLabel = document.getElementById('custom-time-label');
    state.chart.subscribeCrosshairMove(this.handleCrosshairMove.bind(this));

    // V5 UPGRADE: Use the new addSeries API
    state.closePriceSeries = state.chart.addSeries(LineSeries, {
      color: config.chartColors.closePriceSeries,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: state.showClosePriceLine,
    });


    // v2.3 SHADOW: Purple prediction line (direction + magnitude derived)
    state.v23PredictionLine = state.chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 2,
      lineStyle: 2, // Dashed
      lastValueVisible: true,
      priceLineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      title: 'v2.3',
    });

    // Initialize strategy lines using factory functions
    state.stopLossLine = createStopLossLine();
    state.targetLine = createTargetLine();
    state.trailingStopActivationLine = createTrailingStopActivationLine();

    state.candleSeries.attachPrimitive(state.stopLossLine);
    state.candleSeries.attachPrimitive(state.targetLine);
    state.candleSeries.attachPrimitive(state.trailingStopActivationLine);

    window.chart = state.chart;
    try {
      // Notify other parts of the UI that the chart instance is ready
      const evt = new CustomEvent('chart:ready', { detail: { chart: state.chart } });
      document.dispatchEvent(evt);
    } catch (e) {
      // Fallback for environments without CustomEvent
      try { document.dispatchEvent(new Event('chart:ready')); } catch {}
    }

    state.markersAPI = window.LightweightCharts.createSeriesMarkers(state.candleSeries, state.seriesMarkers);

  },

  /**
   * Clears all data from all chart series and resets prediction markers.
   */
  resetSeriesData() {
    state.candleSeries?.setData([]);
    state.predictedDots?.setData([]);
    state.v23PredictionLine?.setData([]);
    state.closePriceSeries?.setData([]);
    state.binancePriceLine?.setData([]);
    // NOTE: Strategy lines are preserved during timeframe changes
    // They will be updated by the next heartbeat if still active
  },

  /**
   * Sets the data for the main candlestick series.
   * @param {import('./state.js').CandlestickData[]} data - Array of candlestick data points.
   */
  updateCandleSeries(data) {
    state.candleSeries?.setData(shiftDataToLocalTime(data));
    const shiftSeconds = state.lineShiftMinutes * 60;
    // Apply timezone conversion first, then time shift
    const timezoneConvertedData = shiftDataToLocalTime(data);
    const closePrices = timezoneConvertedData.map(d => ({ time: d.time + shiftSeconds, value: d.close }));
    state.closePriceSeries?.setData(closePrices);
  },

  /**
   * Updates a single candlestick data point in the main series (used for live updates).
   * @param {import('./state.js').CandlestickData} candle - The candlestick data point to update.
   */
  updateSingleCandle(candle) {
    state.candleSeries?.update(shiftPointToLocalTime(candle));
    const shiftSeconds = state.lineShiftMinutes * 60;
//    state.closePriceSeries?.update(shiftPointToLocalTime({ time: candle.time + shiftSeconds, value: candle.close }));
  },

  /**
   * Refreshes the close price series based on the current candle data and lineShiftMinutes.
   */
  refreshClosePriceSeries() {
    // V5 UPGRADE: The series.data() method is deprecated. The recommended way is to
    // manage the data state outside the chart. Since the data is already passed
    // to updateCandleSeries, we should store it in the state for reuse.
    // For now, leaving as is, but this is a candidate for future refactoring.
    const candleData = state.candleSeries?.data();
    if (candleData && candleData.length > 0) {
      const shiftSeconds = state.lineShiftMinutes * 60;
      // candleData is already timezone-converted, so just apply time shift
      const closePrices = candleData.map(d => ({ time: d.time + shiftSeconds, value: d.close }));
      state.closePriceSeries?.setData(closePrices);
    }
  },

  /**
   * Updates prediction visualization elements (dots, markers, and confidence bands).
   * @param {Object} predictionData - Prediction data to update
   * @param {import('./state.js').LineData[]} [predictionData.predictedPricePoints] - Array of prediction dot points
   * @param {import('./state.js').LineData[]} [predictionData.predictionPricePoints] - Array of prediction price points
   * @param {import('./state.js').LineData[]} [predictionData.binancePricePoints] - Array of Binance price points
   */
  updatePredictionVisuals(predictionData) {

    const { predictedPricePoints, predictionPricePoints, binancePricePredictedPoints, mapeLowerPoints, mapeUpperPoints } = predictionData;

    if (predictedPricePoints) {
      state.predictedDots?.setData(shiftDataToLocalTime(predictedPricePoints.filter(pred => pred !== null && pred !== undefined)));
    }

    if (predictionPricePoints) {
      state.predictionPriceLine?.setData(shiftDataToLocalTime(predictionPricePoints.filter(pred => pred !== null && pred !== undefined)));
    }

    if (binancePricePredictedPoints) {
      state.binancePriceLine?.setData(shiftDataToLocalTime(binancePricePredictedPoints.filter(pred => pred !== null && pred !== undefined)));
    }

    if (mapeLowerPoints) {

      state.mapeLowerLine?.setData(shiftDataToLocalTime(mapeLowerPoints.filter(lmp => lmp !== null && lmp !== undefined)));
    }

    if (mapeUpperPoints) {
      state.mapeUpperLine?.setData(shiftDataToLocalTime(mapeUpperPoints.filter(mup => mup !== null && mup !== undefined)));
    }

    },

  /**
   * Parse an RFC3339 timestamp and align it to the current interval
   * @param {string} timeStr - RFC3339 timestamp string
   * @returns {number} - Aligned timestamp in milliseconds with collision handling
   */
  parseAndAlignTime(timeStr) {
    const parsedTime = parseTimeToSecondsUTC(timeStr);

    // If force bar alignment is enabled, align to the start of candle intervals
    if (state.forceBarAlignment) {
      return parsedTime - (parsedTime % (config.currentInterval));
    }

    // Otherwise return the raw parsed timestamp
    return parsedTime;
  },

  /**
   * Central utility to update all markers on the chart.
   * It combines prediction markers and strategy event markers.
   */
  updateAllMarkers() {
    if (!state.candleSeries) return;

    const allMarkers = [...state.seriesMarkers, ...state.strategyEventMarkers];

    // this.printMarkerTimesRFC3339(allMarkers, { intervalSeconds: config.currentInterval, label: 'ALL MARKERS', showRemainder: true });

    const sortedMarkers = this.sortMarkers(allMarkers);
    // this.printMarkerTimesRFC3339(sortedMarkers, { intervalSeconds: config.currentInterval, label: 'SORTED MARKERS', showRemainder: true });

    // align markers to candle intervals - create new objects to avoid modifying originals
    const alignedMarkers = sortedMarkers.map(m => {
      // Parse and align to UTC interval boundaries
      const alignedTime = this.parseAndAlignTime(m.time);

      // CRITICAL: Apply timezone shift to match the candle coordinate system
      // Candles are shifted via shiftDataToLocalTime(), markers must be shifted too
      const shiftedTime = shiftTimeStampToLocal(alignedTime);

      return {
        ...m,
        time: shiftedTime
      };
    });

    this.printMarkerTimesRFC3339(alignedMarkers, { intervalSeconds: config.currentInterval, label: 'ALIGNED MARKERS', showRemainder: true });

    state.markersAPI.setMarkers(alignedMarkers); // still apply (clears markers)
  },

  isAlignedToInterval(sec, intervalSeconds) {
    if (!Number.isFinite(sec)) return false;
    if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return true; // no interval -> skip check
    return (sec % intervalSeconds) === 0;
  },

  sortMarkers(markers) {
    return (Array.isArray(markers) ? markers : [])
      .slice()
        .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  },

  printMarkerTimesRFC3339(markers, { intervalSeconds, label = 'MARKERS', showRemainder = false } = {}) {
    const src = Array.isArray(markers) ? markers : [];

    const rows = src.map((m, i) => {
      const sec = parseTimeToSecondsUTC(m.time);
      const aligned = this.isAlignedToInterval(sec, intervalSeconds);
      const remainder = (showRemainder && Number.isFinite(sec) && Number.isFinite(intervalSeconds))
        ? (sec % intervalSeconds)
        : undefined;

      return {
        i,
        time_raw: m.time,
        seconds: sec,
        rfc3339: toRFC3339FromSeconds(sec),
        aligned,
        ...(showRemainder ? { remainder } : {}),
        price: m.price,
        shape: m.shape,
        position: m.position,
      };
    });

    logger.debug('Chart data debug', { ctx: ['Chart', 'Debug'], label, count: rows.length, intervalSeconds: intervalSeconds ?? 'n/a' });
    // console.table(rows);

    const secs = rows.map(r => r.seconds).filter(Number.isFinite);
    if (secs.length) {
      const minS = Math.min(...secs);
      const maxS = Math.max(...secs);
      const misaligned = rows.filter(r => r.aligned === false).length;
      logger.debug('Chart data coverage', {
        ctx: ['Chart', 'Debug'],
        label,
        minS,
        maxS,
        minTime: toRFC3339FromSeconds(minS),
        maxTime: toRFC3339FromSeconds(maxS),
        misaligned,
        total: rows.length
      });
    } else {
      logger.debug('Chart data - no valid times', { ctx: ['Chart', 'Debug'], label });
    }
  },


  /**
   * Adds a prediction marker to the chart.
   * @param {import('./state.js').SeriesMarker} marker - The marker to add.
   */
  addMarker(marker) {
    state.seriesMarkers.push(marker);
    this.updateAllMarkers();
  },

  /**
   * Clears all prediction markers from the chart.
   */
  clearMarkers() {
    state.seriesMarkers = [];
    this.updateAllMarkers();
  },

  /**
   * Updates all prediction visualizations based on batch prediction data
   * @param {Array<{time: number, price: number}>} predictions - Array of processed predictions
   */

  /**
   * Update v2.3 shadow prediction lines on the chart.
   * Draws a purple dashed line from current price through 1H → 2H → 4H targets.
   * Each target point is labelled with confidence in the tooltip via state.v23LatestData.
   */
  updateV23Lines(data) {
    if (!state.v23PredictionLine) return;

    const predTimeSec = Math.floor(new Date(data.timestamp).getTime() / 1000);
    const currentPrice = parseFloat(data.current_price);

    // Derive target prices from probability + magnitude
    const calcTarget = (prob, mag) => {
      const sign = prob >= 0.5 ? 1 : -1;
      return currentPrice * (1 + sign * Math.abs(mag || 0) / 100);
    };

    const target1h = calcTarget(data.direction_1h || 0.5, data.magnitude_1h || 0);
    const target2h = calcTarget(data.direction_2h || 0.5, data.magnitude_2h || 0);
    const target4h = calcTarget(data.direction_4h || 0.5, data.magnitude_4h || 0);

    // Build the 4-point line: now → +1H → +2H → +4H
    const linePoints = [
      { time: predTimeSec,          value: currentPrice },
      { time: predTimeSec + 3600,   value: target1h },
      { time: predTimeSec + 7200,   value: target2h },
      { time: predTimeSec + 14400,  value: target4h },
    ];

    // Store for tooltip lookup
    state.v23LatestData = {
      ...data,
      target1h, target2h, target4h,
      predTimeSec,
    };

    try {
      state.v23PredictionLine.setData(linePoints);
    } catch (e) {
      // Time ordering issue — silently skip
    }
  },

  updateAllPredictions(predictions) {
    if (!Array.isArray(predictions) || predictions.length === 0) {
      return;
    }

    // Create dot points for the line series
    const predictedPricePoints = predictions.map(pred => ({
      time: this.parseAndAlignTime(pred.predicted_time),
      value: pred.predicted_price,
    }));

    // Create prediction price points (for the cyan line)
    const predictionPricePoints = predictions.map(pred => ({
      time: this.parseAndAlignTime(pred.prediction_time),
      value: pred.prediction_price
    }));

    // Create binance price points (for the cyan line)
    const binancePricePredictedPoints = predictions
      .filter(pred => pred.predicted_time !== null && pred.binance_trade_price_predicted !== null)
      .map(pred => ({
        time: this.parseAndAlignTime(pred.predicted_time),
        value: pred.binance_trade_price_predicted
      }));

    const { mapeLowerPoints, mapeUpperPoints } = this.createMapePoints(predictions);

    // Update all visuals in one batch
    this.updatePredictionVisuals({
      predictedPricePoints,
      predictionPricePoints,
      binancePricePredictedPoints: binancePricePredictedPoints, // Pass the new data
      mapeLowerPoints,
      mapeUpperPoints
    });



  },

  /**
   * Adds a new prediction to the chart
   * @param {{time: number, price: number}} prediction
   */

  addNewPrediction(prediction) {
    // Skip if data is currently being reloaded (prevents race condition)
    if (state.isReloading) {
      logger.debug('Skipping addNewPrediction during reload', { ctx: ['ChartManager', 'Prediction'] });
      return;
    }

    const newPredictionDot = {
      time: this.parseAndAlignTime(prediction.predicted_time),
      value: prediction.predicted_price,
    };

    if (state.predictedDots) {
      state.predictedDots.update(shiftPointToLocalTime(newPredictionDot));
      logger.debug('Added new prediction dot', { ctx: ['ChartManager', 'Prediction'], time: newPredictionDot.time, value: newPredictionDot.value });
    } else {
      logger.warning('predictedDots series not initialized', { ctx: ['ChartManager', 'Prediction'] });
    }

    const newPredictionPriceDot = {
      time: this.parseAndAlignTime(prediction.prediction_time),
      value: prediction.prediction_price,
    };

    state.predictionPriceLine?.update(shiftPointToLocalTime(newPredictionPriceDot));

    const { mapeLowerPoints, mapeUpperPoints } = this.createMapePoints([prediction]);

    if (mapeLowerPoints.length > 0) {
      state.mapeLowerLine?.update(shiftPointToLocalTime(mapeLowerPoints[0]));
    }
    if (mapeUpperPoints.length > 0) {
      state.mapeUpperLine?.update(shiftPointToLocalTime(mapeUpperPoints[0]));
    }
  },


  /**
   * Updates an existing prediction on the chart
   * @param {{time: number, price: number}} prediction
   */

  updateLatestPrediction(prediction) {
    // Skip if data is currently being reloaded (prevents race condition)
    if (state.isReloading) {
      logger.debug('Skipping updateLatestPrediction during reload', { ctx: ['ChartManager', 'Prediction'] });
      return;
    }

    const newPredictionDot = {
      time: this.parseAndAlignTime(prediction.predicted_time),
      value: prediction.predicted_price,
    }

    if (state.predictedDots) {
      state.predictedDots.update(shiftPointToLocalTime(newPredictionDot));
      logger.debug('Updated latest prediction dot', { ctx: ['ChartManager', 'Prediction'], time: newPredictionDot.time, value: newPredictionDot.value });
    } else {
      logger.warning('predictedDots series not initialized', { ctx: ['ChartManager', 'Prediction'] });
    }

    const newPredictionPriceDot = {
      time: this.parseAndAlignTime(prediction.prediction_time),
      value: prediction.prediction_price,
    };

    state.predictionPriceLine?.update(shiftPointToLocalTime(newPredictionPriceDot));

  },

  /**
   * Updates an existing prediction on the chart
   * @param {{time: number, price: number}} prediction
   */

  updateDerivedMeasures(prediction) {

    if (prediction.binance_trade_time_predicted != null && prediction.binance_trade_price_predicted != null) {
      const newBinancePricePredictedDot = {
        time: this.parseAndAlignTime(prediction.binance_trade_time_predicted),
        value: prediction.binance_trade_price_predicted,
      };

      state.binancePriceLine?.update(shiftPointToLocalTime(newBinancePricePredictedDot));

    }

    // Update MAPE lines
    const { mapeLowerPoints, mapeUpperPoints } = this.createMapePoints([prediction]);

    if (mapeLowerPoints.length > 0) {
      state.mapeLowerLine?.update(shiftPointToLocalTime(mapeLowerPoints[0]),true);
    }

    if (mapeUpperPoints.length > 0) {
      state.mapeUpperLine?.update(shiftPointToLocalTime(mapeUpperPoints[0]),true);
    }

  },

  /**
   * Helper method to format timestamps to concise date string for tooltips
   * @param {string} rfc3339_ts - RFC3339 formatted string
   * @returns {string} - Formatted concise date string
   */
  getDisplayTimeFromRFC3339(rfc3339_ts) {
    const date = new Date(rfc3339_ts);
    // Format: May 3, 15:30
    const options = {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false // Use 24-hour format
    };

    if (state.timeDisplayMode === 'UTC') {
      return date.toLocaleDateString('en-US', {
        ...options,
        timeZone: 'UTC'
      });
    }
    else if (state.timeDisplayMode === 'NY') {
      return date.toLocaleDateString('en-US', {
        ...options,
        timeZone: 'America/New_York'
      });
    }
    else {
      return date.toLocaleDateString(undefined, options);
    }
  },

  /**
   * Handles crosshair move events to show hover markers
   * @param {Object} param - The crosshair move event parameter.
   */
  handleCrosshairMove: (function() {

    // Use a flag to prevent recursive calls
    let isUpdating = false;

    return function(param) {

      if (!param) return;

      if (param.point && param.point.x) {
        this.updateTimeLabel(param.point.x, param.time);
      }
      else {
        state.timeLabel.style.display = 'none';
      }

      // Exit early if we're already in the middle of an update
      if (isUpdating) return;

      // Exit early if necessary components aren't available
      if (!state.chart || !state.predictedDots || !state.blueDotSeries) return;

      // PRIORITY 1: Check strategy markers FIRST (entry/exit markers take priority)
      const strategyMarkerTooltip = this.checkStrategyMarkerHover(param);
      if (strategyMarkerTooltip && state.tooltipElement) {
        try {
          isUpdating = true;
          state.lastHoveredPredictionTime = null;
          state.blueDotSeries.setData([]);

          const tooltipX = param.point.x + 15;
          const tooltipY = param.point.y + 15;
          state.tooltipElement.innerHTML = strategyMarkerTooltip;
          state.tooltipElement.style.left = `${tooltipX}px`;
          state.tooltipElement.style.top = `${tooltipY}px`;
          state.tooltipElement.style.display = 'block';
        } finally {
          isUpdating = false;
        }
        return; // Exit early - strategy marker takes priority
      }

      // PRIORITY 2: Get the series data directly from the crosshair event
      const predictedDot = param.seriesData?.get(state.predictedDots);

      // Only process if we're directly over a prediction dot
      if (predictedDot) {

        // Get the prediction time (dot time) and current time
        const predictedDotBarTime = predictedDot.time;

        // Convert the predictedDotBarTime back to UTC
        const predictedDotBarTimeUtc = unshiftTimeStampToUtc(predictedDotBarTime);

        // Calculate tooltip position
        const tooltipX = param.point.x + 15; // Offset to avoid overlapping the cursor
        const tooltipY = param.point.y + 15;


        // Check if this point is the same as the last point hovered
        if (state.lastHoveredPredictionTime === predictedDotBarTimeUtc) {

          // Update and show tooltip
          // state.tooltipElement.innerHTML = tooltipHTML;
          state.tooltipElement.style.left = `${tooltipX}px`;
          state.tooltipElement.style.top = `${tooltipY}px`;
          state.tooltipElement.style.display = 'block';

          // Do not process if the time has not changed
          return;
        }

        // Update the last hovered prediction time
        state.lastHoveredPredictionTime = predictedDotBarTimeUtc;

        // Look up the complete prediction data from our stored predictions
        const completeData = state.predictions?.find(p => this.parseAndAlignTime(p.predicted_time) === predictedDotBarTimeUtc);

        if (!completeData) {
          return;
        }

        // Use prediction_time if available from standardized field names, with fallbacks
        const predictionTime = completeData.prediction_time || null;
        const predictionPrice = completeData.prediction_price || null;

        // Show tooltip with prediction metadata
        if (state.tooltipElement) {

          // Format metadata for display using the standardized field names
          // v2.3 tooltip overlay
          if (state.v23LatestData) {
            const d = state.v23LatestData;
            const p1h = d.direction_1h || 0.5;
            const p2h = d.direction_2h || 0.5;
            const p4h = d.direction_4h || 0.5;
            const conf = d.confidence || 0;
            const dir = d.direction || 'NEUTRAL';
            const dirColor = dir === 'LONG' ? '#00ff88' : dir === 'SHORT' ? '#ff4444' : '#888';
            const confPct = (conf * 100).toFixed(0);
            const v23TipHTML = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #333;">
              <span style="color:#a855f7;font-weight:bold;font-size:10px;">v2.3 SHADOW</span>
              <span style="color:${dirColor};margin-left:6px;font-weight:bold;">${dir}</span>
              <span style="color:${conf>=0.5?'#00ff88':'#888'};margin-left:4px;">${confPct}% conf</span>
              <div style="font-size:10px;margin-top:2px;color:#888;">
                1H: <span style="color:${p1h>=0.55?'#00ff88':p1h<=0.45?'#ff4444':'#888'}">${(p1h*100).toFixed(0)}%↑</span>
                &nbsp;2H: <span style="color:${p2h>=0.55?'#00ff88':p2h<=0.45?'#ff4444':'#888'}">${(p2h*100).toFixed(0)}%↑</span>
                &nbsp;4H: <span style="color:${p4h>=0.55?'#00ff88':p4h<=0.45?'#ff4444':'#888'}">${(p4h*100).toFixed(0)}%↑</span>
              </div>
            </div>`;
            if (state.tooltipElement) {
              // Append v2.3 info to tooltip after it renders
              setTimeout(() => {
                const tip = state.tooltipElement;
                if (tip.style.display !== 'none' && !tip.innerHTML.includes('v2.3')) {
                  tip.innerHTML += v23TipHTML;
                }
              }, 10);
            }
          }

          let tooltipHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">Prediction Data - Timezone: ${state.timeDisplayMode}</div>
            <div style="color:${config.chartColors.predictedDots}">Predicted Time: ${completeData.predicted_time ? this.getDisplayTimeFromRFC3339(completeData.predicted_time) : "N/A"}</div>
            <div style="color:${config.chartColors.predictedDots}">Predicted Price: ${completeData.predicted_price ? completeData.predicted_price.toFixed(2) : "N/A"}</div>`;

          // Add raw predictionTime and predictionPrice values
          tooltipHTML += `<div style="color:${config.chartColors.predictionPriceLine}">Prediction Time: ${completeData.prediction_time ? this.getDisplayTimeFromRFC3339(completeData.prediction_time) : "N/A"}</div>`;
          tooltipHTML += `<div style="color:${config.chartColors.predictionPriceLine}">Prediction Price: ${completeData.prediction_price ? completeData.prediction_price.toFixed(2) : "N/A"}</div>`;

          // const mapeLowerPoint = param.seriesData?.get(state.mapeLowerLine);
          // const mapeUpperPoint = param.seriesData?.get(state.mapeUpperLine);
          // tooltipHTML += `<div style="color: pink;">MAPE Lower: ${mapeLowerPoint ? mapeLowerPoint.value.toFixed(4) : "N/A"}</div>`;
          // tooltipHTML += `<div style="color: pink;">MAPE Upper: ${mapeUpperPoint ? mapeUpperPoint.value.toFixed(4) : "N/A"}</div>`;
          // Add Binance price data if available

          if (state.verboseTooltip) {
              tooltipHTML += `<div style="color:${config.chartColors.binancePricePredictedPoints};">Binance Predicted Time: ${completeData.binance_trade_time_predicted ? this.getDisplayTimeFromRFC3339(completeData.binance_trade_time_predicted) : "--"}</div>`;
          }
          tooltipHTML += `<div style="color:${config.chartColors.binancePricePredictedPoints};">Binance Predicted Price: ${completeData.binance_trade_price_predicted ? completeData.binance_trade_price_predicted.toFixed(2) : "--"}</div>`;

          if (state.verboseTooltip) {
            tooltipHTML += `<div style="color:${config.chartColors.binancePricePredictionPoints};">Binance Prediction Time: ${completeData.binance_trade_time_prediction ? this.getDisplayTimeFromRFC3339(completeData.binance_trade_time_prediction) : "--"}</div>`;
          }
          tooltipHTML += `<div style="color:${config.chartColors.binancePricePredictionPoints};">Binance Prediction Price: ${completeData.binance_trade_price_prediction ? completeData.binance_trade_price_prediction.toFixed(2) : "--"}</div>`;


          if (state.verboseTooltip) {
            // Add a spacer with a thin line
            tooltipHTML += `<div style="margin: 5px 0; border-top: 1px solid rgba(255,255,255,0.3);"></div>`;


            const actualMove = completeData.binance_trade_price_predicted - completeData.binance_trade_price_prediction;
            const actualMovePercentage = (actualMove / completeData.binance_trade_price_prediction) * 100;
            const actualPredictedMove = completeData.predicted_price - completeData.binance_trade_price_prediction;
            const actualPredictedMovePercentage = (actualPredictedMove / completeData.binance_trade_price_prediction) * 100;

            const prediction_error = completeData.binance_trade_price_predicted - completeData.predicted_price;
            const prediction_error_percentage = (prediction_error / completeData.predicted_price) * 100;
            const prediction_error_color = actualMove*actualPredictedMove > 0 ? "lightgreen" : "lightsalmon";
            tooltipHTML += `<div style="color: ${prediction_error_color};">Prediction Error: ${completeData.binance_trade_price_predicted ? prediction_error.toFixed(2) : "--"} (${completeData.binance_trade_price_predicted ? prediction_error_percentage.toFixed(2) : "--"}%)</div>`;

            const actualPnL = actualPredictedMove * actualMove > 0 ? Math.abs(actualMove) : -Math.abs(actualMove);
            const actualPnLPercentage = (actualPnL / completeData.binance_trade_price_prediction) * 100;
            const pnlColor = actualPnL > 0 ? "lightgreen" : "darksalmon";
            tooltipHTML += `<div style="color: ${pnlColor}; font-weight: bold;">Actual PnL: ${completeData.binance_trade_price_predicted ? actualPnL.toFixed(2) : "--"} (${completeData.binance_trade_price_prediction ? actualPnLPercentage.toFixed(2) : "--"}%)</div>`;

            // Add a spacer with a thin line
            tooltipHTML += `<div style="margin: 5px 0; border-top: 1px solid rgba(255,255,255,0.3);"></div>`;

            tooltipHTML += `<div>Predicted Move: ${completeData.predicted_move.toFixed(2)} (${completeData.predicted_move_percentage.toFixed(2)}%)</div>`;
            tooltipHTML += `<div>Actual Predicted Move: ${completeData.binance_trade_price_prediction ? actualPredictedMove.toFixed(2) : "--"} (${completeData.binance_trade_price_prediction ? actualPredictedMovePercentage.toFixed(2) : "--"}%)</div>`;
            tooltipHTML += `<div>Actual Move: ${completeData.binance_trade_price_predicted ? actualMove.toFixed(2) : "--"} (${completeData.binance_trade_price_predicted ? actualMovePercentage.toFixed(2) : "--"}%)</div>`;

            const move_diff = actualMove - completeData.predicted_move;
            const move_diff_percentage = (move_diff / completeData.predicted_move) * 100;

            const moveColor = move_diff > 0 ? "lightgreen" : "darksalmon";
            tooltipHTML += `<div style="color: ${moveColor};">Move Diff: ${move_diff.toFixed(2)} (${move_diff_percentage.toFixed(2)}%)</div>`; // Updated label and format

            // Add MAPE score if available
            if (completeData.mape_score != null) {
              // Format MAPE with 2 decimal places and color based on value
              const mapeValue = completeData.mape_score.toFixed(2);
              let mapeColor = config.chartColors.mapeCalcLine;

              tooltipHTML += `<div style="color: ${mapeColor};">MAPE (20): ${mapeValue}%</div>`;
            }
          }

          // Update and show tooltip
          state.tooltipElement.innerHTML = tooltipHTML;
          state.tooltipElement.style.left = `${tooltipX}px`;
          state.tooltipElement.style.top = `${tooltipY}px`;
          state.tooltipElement.style.display = 'block';
        }

        try {
          isUpdating = true;
          // Show the prediction marker at the calculated time position

          if (completeData.prediction_time) {

            let val = null;
            let dotColor = config.chartColors.blueDotSeries; // Default to blue dot color

            if (completeData.binance_trade_price_prediction != null) {

              val = completeData.binance_trade_price_prediction;

            } else {

              const targetTime = parseTimeToSecondsUTC(completeData.prediction_time);

              // Find the closest prediction to the target time
              const predictionData = state.predictions.reduce((latest, p) => {
                const time = parseTimeToSecondsUTC(p.binance_trade_time_predicted);
                return (time <= targetTime && (!latest || time > parseTimeToSecondsUTC(latest.binance_trade_time_predicted))) ? p : latest;
              }, null);

              if (predictionData) {
                val = predictionData.binance_trade_price_predicted;
              }

            }

            // If no binance data available, use prediction_price as fallback
            if (val == null && completeData.prediction_price != null) {
              val = completeData.prediction_price;
              dotColor = config.chartColors.predictionPriceLine; // Use prediction line color for fallback
            }

            // Only add marker if we have valid time and price
            if (val != null) {
              state.blueDotSeries.setData([{
                time: shiftTimeStampToLocal(this.parseAndAlignTime(completeData.prediction_time)),
                value: val,
                color: dotColor
              }]);
            }


          } else {
            // Clear markers if data is incomplete
            state.blueDotSeries.setData([]);
          }

        }
        finally {

          isUpdating = false;

        }
      } else{

        try {

          isUpdating = true;
          // Clear markers when not over a prediction dot or strategy marker

          state.lastHoveredPredictionTime = null;
          state.blueDotSeries.setData([]);

          if (state.tooltipElement) {
            state.tooltipElement.style.display = 'none';
          }

        } finally {

          isUpdating = false;

        }
      }
    };
  })(),

  /**
   * Handles mouse leave events on the chart container to clear hover markers.
   */
  handleChartMouseLeave() {
    if (state.blueDotSeries) {
      state.blueDotSeries.setData([]);
    }
    if (state.tooltipElement) {
      state.tooltipElement.style.display = 'none';
    }
  },

  /**
   * Checks if the mouse is hovering over a strategy marker and returns tooltip HTML if so.
   * @param {Object} param - The crosshair move event parameter
   * @returns {string|null} - Tooltip HTML if hovering over a marker, null otherwise
   */
  checkStrategyMarkerHover(param) {
    if (!param.point || !state.strategyEventMarkers || state.strategyEventMarkers.length === 0) {
      return null;
    }

    const mouseX = param.point.x;
    const mouseY = param.point.y;
    const hitRadius = 20; // Pixels within which to detect hover

    // Check each strategy marker
    for (const marker of state.strategyEventMarkers) {
      // Apply the same time transformation as updateAllMarkers()
      const alignedTime = this.parseAndAlignTime(marker.time);
      const shiftedTime = shiftTimeStampToLocal(alignedTime);

      // Convert marker time and price to screen coordinates
      const markerX = state.chart.timeScale().timeToCoordinate(shiftedTime);
      const markerY = state.candleSeries.priceToCoordinate(marker.price);

      if (markerX === null || markerY === null) continue;

      // Check if mouse is within hit radius of the marker
      const distance = Math.sqrt(Math.pow(mouseX - markerX, 2) + Math.pow(mouseY - markerY, 2));

      if (distance <= hitRadius) {
        // Get the full event data for this marker
        const eventData = state.strategyEventData.get(marker.id);
        if (eventData) {
          return this.buildStrategyMarkerTooltip(eventData);
        }
      }
    }

    return null;
  },

  /**
   * Builds tooltip HTML for a strategy marker (entry or exit).
   * @param {Object} eventData - The full strategy event data
   * @returns {string} - The tooltip HTML
   */
  buildStrategyMarkerTooltip(eventData) {
    const position = eventData.position; // 'OPEN' or 'CLOSE'
    const data = eventData.event_data || {};

    if (position === 'OPEN') {
      // Entry marker - show entry info
      const direction = data.signal_direction || 'N/A';
      const entryPrice = data.entry_price ? data.entry_price.toFixed(2) : 'N/A';
      const directionColor = direction === 'LONG' ? 'rgba(0, 255, 136, 1)' : 'rgba(255, 68, 68, 1)';
      const emoji = direction === 'LONG' ? '🟢' : '🔴';

      return `
        <div style="font-weight: bold; margin-bottom: 5px; color: ${directionColor};">${emoji} ENTRY - ${direction}</div>
        <div>Entry Price: $${entryPrice}</div>
        <div style="color: #888; font-size: 0.9em;">${eventData.event_time ? this.getDisplayTimeFromRFC3339(eventData.event_time) : ''}</div>
      `;
    } else if (position === 'CLOSE') {
      // Exit marker - show PNL info based on IPC Contract Mode
      const pnlDollar = data.pnl;  // Dollar P&L with contracts
      const pnlPercentage = data.pnl_percentage;  // Percentage P&L
      const entryPrice = data.entry_price ? data.entry_price.toFixed(2) : 'N/A';
      const exitPrice = data.current_price ? data.current_price.toFixed(2) : 'N/A';
      const closeReason = data.close_reason || 'N/A';

      // Check global IPC Contract Mode (default: false = show percentage)
      const useIpcMode = window.ipcContractMode || false;

      // Determine display value based on mode
      let pnlDisplay, isProfitable;
      if (useIpcMode) {
        // IPC Mode: Show dollar P&L with contracts
        isProfitable = pnlDollar >= 0;
        const pnlSign = pnlDollar >= 0 ? '+' : '';
        pnlDisplay = `${pnlSign}$${pnlDollar ? Math.abs(pnlDollar).toFixed(2) : 'N/A'}`;
      } else {
        // Default: Show percentage P&L (per BTC)
        isProfitable = pnlPercentage >= 0;
        const pctSign = pnlPercentage >= 0 ? '+' : '';
        pnlDisplay = pnlPercentage !== undefined && pnlPercentage !== null
          ? `${pctSign}${pnlPercentage.toFixed(2)}%`
          : 'N/A';
      }

      const pnlColor = isProfitable ? 'rgba(173, 255, 47, 1)' : 'rgba(255, 0, 255, 1)';
      const emoji = isProfitable ? '💚' : '💔';
      const modeLabel = useIpcMode ? ' (IPC)' : '';

      return `
        <div style="font-weight: bold; margin-bottom: 5px; color: ${pnlColor};">${emoji} EXIT - ${closeReason}</div>
        <div style="color: ${pnlColor}; font-weight: bold; font-size: 1.1em;">PNL${modeLabel}: ${pnlDisplay}</div>
        <div>Entry: $${entryPrice} → Exit: $${exitPrice}</div>
        <div style="color: #888; font-size: 0.9em;">${eventData.event_time ? this.getDisplayTimeFromRFC3339(eventData.event_time) : ''}</div>
      `;
    }

    return null;
  },

  /**
   * Creates the data point arrays for the upper and lower MAPE bounds from a predictions array.
   * @param {Array} predictions - The array of processed predictions.
   * @returns {{mapeLowerPoints: Array, mapeUpperPoints: Array}} An object containing the points for both lines.
   */
  createMapePoints(predictions) {
    if (!Array.isArray(predictions)) {
      return { mapeLowerPoints: [], mapeUpperPoints: [] };
    }

    const mainColor = config.chartColors.mapeCalcLine;
    const fallbackColor = config.chartColors.mapeLastKnownLine;

    const validMapePredictions = predictions.filter(pred =>
      typeof pred.mape_score === 'number' && pred.predicted_time != null
    );

    // Create lower bound points from the filtered array.
    const mapeLowerPoints = validMapePredictions.map(pred => ({
      time: this.parseAndAlignTime(pred.predicted_time),
      value: pred.predicted_price * (1 - pred.mape_score / 100),
      color: pred.mape_score_type === 'fallback' ? fallbackColor : mainColor
    }));

    // Create upper bound points from the SAME filtered array.
    const mapeUpperPoints = validMapePredictions.map(pred => ({
      time: this.parseAndAlignTime(pred.predicted_time),
      value: pred.predicted_price * (1 + pred.mape_score / 100),
      color: pred.mape_score_type === 'fallback' ? fallbackColor : mainColor
    }));

    return { mapeLowerPoints, mapeUpperPoints };
  },

  /**
   * Updates only the MAPE line series on the chart.
   * @param {Array} predictions - The array of predictions with up-to-date MAPE scores.
   */
  updateMapeSeries(predictions) {
    if (!Array.isArray(predictions)) return;

    // Use the new helper to create the points.
    const { mapeLowerPoints, mapeUpperPoints } = this.createMapePoints(predictions);

    // Set the data for the MAPE series
    state.mapeLowerLine?.setData(shiftDataToLocalTime(mapeLowerPoints));
    state.mapeUpperLine?.setData(shiftDataToLocalTime(mapeUpperPoints));
  },


  /**
   * Creates a tooltip element for displaying prediction metadata.
   */
  createTooltipElement() {
    // Remove any existing tooltip first
    const existingTooltip = document.getElementById('chart-tooltip');

    if (existingTooltip) {

      existingTooltip.remove();

    }

    // Create the tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.display = 'none';
    tooltip.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '8px 10px';
    tooltip.style.borderRadius = '5px';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.zIndex = '1000';
    tooltip.style.fontSize = '12px';
    tooltip.style.maxWidth = '250px';
    tooltip.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
    tooltip.style.border = '1px solid #444';
    document.body.appendChild(tooltip);

    state.tooltipElement = tooltip;
  },

  /* Create time label */
  createTimeLabel() {
    // Remove any existing time label first
    const existingTimeLabel = document.getElementById('time-label');

    if (existingTimeLabel) {
      existingTimeLabel.remove();
    }

    // Create the time label element
    const timeLabel = document.createElement('div');
    timeLabel.id = 'time-label';
    timeLabel.style.position = 'absolute';
    timeLabel.style.bottom = '0';
    timeLabel.style.transform = 'translateX(-50%)';
    timeLabel.style.background = 'rgba(30, 30, 30, 0.9)';
    timeLabel.style.color = 'white';
    timeLabel.style.padding = '2px 6px';
    timeLabel.style.fontSize = '12px';
    timeLabel.style.borderRadius = '2px';
    timeLabel.style.pointerEvents = 'none';
    timeLabel.style.whiteSpace = 'nowrap';
    timeLabel.style.zIndex = '10';
    timeLabel.style.display = 'none';
    document.getElementById('chart-area').appendChild(timeLabel);

    state.timeLabel = timeLabel;
  },

  /**
   * Updates the time label displayed at the bottom of the chart
   * @param {number} x - The x-coordinate position for the label
   * @param {number} timestamp - The timestamp to display in seconds since epoch
   */
  updateTimeLabel(x, timestamp) {

    const date = new Date(timestamp * 1000);
    let formatted = "";
    if (date != null && date instanceof Date && !isNaN(date.getTime())) {
      formatted = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date);
    }

    state.timeLabel.textContent = formatted;
    state.timeLabel.style.display = 'block';
    state.timeLabel.style.left = `${x}px`;
    state.timeLabel.style.bottom = '5px';


    // if (!param.point || !param.point.x) {
    //   state.timeLabel.style.display = 'none';
    //   return;
    // }

    // const date = new Date(param.time * 1000);
    // let formatted = "";
    // if (date != null && date instanceof Date && !isNaN(date.getTime())) {
    //   formatted = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date);
    // }

    // state.timeLabel.textContent = formatted;
    // state.timeLabel.style.display = 'block';
    // state.timeLabel.style.left = `${param.point.x}px`;
    // state.timeLabel.style.bottom = '5px';

  },

  /**
   * Toggle visibility of the prediction price line
   * @param {boolean} visible - Whether the line should be visible
   */
  togglePredictionPriceLine(visible) {
    if (!state.predictionPriceLine) return;

    state.predictionPriceLine.applyOptions({
      visible: visible
    });

  },

  /**
   * Toggle visibility of the Binance actual price line
   * @param {boolean} visible - Whether the line should be visible
   */
  toggleBinancePriceLine(visible) {
    if (!state.binancePriceLine) {
      return;
    }

    state.binancePriceLine.applyOptions({
      visible: visible
    });
  },

  /**
   * Toggle visibility of the MAPE lower bound line
   * @param {boolean} visible - Whether the line should be visible
   */
  toggleMapeLines(visible) {
    if (!state.mapeLowerLine || !state.mapeUpperLine) {
      return;
    }

    state.mapeLowerLine.applyOptions({
      visible: visible
    });

    state.mapeUpperLine.applyOptions({
      visible: visible
    });
  },

  /**
   * Toggle opacity of the candlestick series to dim/highlight them
   * @param {boolean} dimmed - Whether the candlesticks should be dimmed
   */
  toggleCandlestickOpacity(dimmed) {
    if (!state.candleSeries) return;

    // Apply different opacity settings based on the dimmed state
    state.candleSeries.applyOptions({
      upColor: dimmed ? 'rgba(38,166,154,0.3)' : 'rgba(38,166,154,0.6)',
      downColor: dimmed ? 'rgba(239,83,80,0.3)' : 'rgba(239,83,80,0.6)',
      wickUpColor: dimmed ? 'rgba(38,166,154,0.6)' : 'rgba(38,166,154,1)',
      wickDownColor: dimmed ? 'rgba(239,83,80,0.6)' : 'rgba(239,83,80,1)',
      borderUpColor: dimmed ? 'rgba(38,166,154,0.6)' : 'rgba(38,166,154,1)',
      borderDownColor: dimmed ? 'rgba(239,83,80,0.6)' : 'rgba(239,83,80,1)'
    });
  },

  /**
   * Toggle visibility of the close price line
   * @param {boolean} isVisible - Whether the line should be visible
   */
  toggleClosePriceLineVisibility(isVisible) {
    if (state.closePriceSeries) {
      state.closePriceSeries.applyOptions({ visible: isVisible });
    }
  },

  /**
   * Toggle visibility of the predicted line (blue dots)
   * @param {boolean} isVisible - Whether the predicted line should be visible
   */
  togglePredictedLine(isVisible) {
    // Store the current visibility state in the application state
    state.showPredictedLine = isVisible;

    if (state.predictedDots) {

      state.predictedDots.applyOptions({
        lineVisible: isVisible,
      });
    }
  },

  /**
   * Helper function to determine marker specifications based on strategy event data.
   * @param {Object} eventData - The strategy event data
   * @returns {Object} Object containing shape, color, size, and price for the marker
   */
  getMarkerSpecification(eventData) {
    let shape = 'circle';
    let color = '#CCCCCC';
    let size = 1;
    let price = eventData.event_data?.entry_price || eventData.event_data?.current_price;
    let position = 'atPriceMiddle';

    if (eventData.position === 'OPEN') {

      // examples:
      // For an UP arrow where the tip looks ~6–8px below your target price:
      const tipUpAligned = price //this.priceWithPxOffset(state.candleSeries, price, -7);

      // For a DOWN arrow where the tip looks ~6–8px above your target price:
      const tipDownAligned = price //this.priceWithPxOffset(state.candleSeries, price, +7);

      size = 1.5;
      if (eventData.event_data.signal_direction === 'LONG') {
        price = tipUpAligned;
        shape = 'arrowUp';
        position = 'atPriceBottom';
        color = 'rgba(0, 255, 136, 1)'; // Green for LONG
      } else if (eventData.event_data.signal_direction === 'SHORT') {
        price = tipDownAligned;
        shape = 'arrowDown';
        position = 'atPriceTop';
        color = 'rgba(255, 68, 68, 1)'; // Red for SHORT
      }
    } else if (eventData.position === 'CLOSE') {
      price = eventData.event_data.current_price;
      const pnl = eventData.event_data.pnl;
      size = 1;
      if (pnl < 0) {
        shape = 'square';
        color = 'rgba(255,0,255,1)'; // Pink
      } else if (pnl > 0) {
        shape = 'square';
        color = 'rgba(173,255,47,1)'; // Gold
      } else {
        shape = 'square';
        color = 'rgba(192,192,192,1)'; // Grey
      }
    }

    return { shape, color, size, price, position };
  },


  priceWithPxOffset(series, price, px) {
    const y = series.priceToCoordinate(price);
    if (y == null) return price; // series not ready yet
    const y2 = y + px; // px > 0 moves marker DOWN; px < 0 moves UP
    return series.coordinateToPrice(y2) ?? price;
  },

  /**
   * Clears all strategy lines from the chart.
   */
  clearStrategyLines() {
    if (state.stopLossLine) {
      state.stopLossLine.hide();
    }
    if (state.targetLine) {
      state.targetLine.hide();
    }
    if (state.trailingStopActivationLine) {
      state.trailingStopActivationLine.hide();
    }
  },

  /**
   * Clears all strategy event markers from the chart.
   */
  clearStrategyMarkers() {
    if (state.strategyEventMarkers.length > 0) {
        state.strategyEventMarkers = [];
        state.strategyEventData.clear();
        this.updateAllMarkers();
    }
  },

  /**
   * Clears all strategy data (both lines and markers).
   */
  clearAllStrategyData() {
    this.clearStrategyLines();
    this.clearStrategyMarkers();
  },

  /**
   * Displays historic strategy events as markers on the chart.
   * @param {Array<Object>} events - An array of strategy event objects from the API.
   */
  displayStrategyMarkers(events) {
    // If there are no new events, ensure any old ones are cleared.
    if (!events || events.length === 0) {
      this.clearStrategyMarkers();
      return;
    }

    // Add all historic event IDs to the processed set to prevent duplicates
    import('./StrategyDataManager.js').then(({ StrategyDataManager }) => {
      events.forEach(event => {
        if (event.event_id) {
          StrategyDataManager._processedEventIds.add(event.event_id);
        }
      });
    });

    // Clear previous event data
    state.strategyEventData.clear();

    state.strategyEventMarkers = events.map(event => {
      const markerId = `strategy-${event.event_id}`;
      const { shape, color, size, position, price } = this.getMarkerSpecification(event);

      // Store the full event data for tooltip access
      state.strategyEventData.set(markerId, event);

      return {
        id: markerId,
        time: event.event_time,
        price: price,
        shape: shape,
        position: position,
        color: color,
        size: size,
      };
    });

    // Note: updateAllMarkers() is NOT called here
    // Caller is responsible for calling it at the appropriate time
    // This allows reloadData() to defer marker rendering until the end

    // Historic events are only used for markers, not strategy lines
    // Strategy lines are only displayed from live Redis data via canonical API
  },


  /**
   * Creates a strategy event marker from event data.
   * @param {Object} eventData - The strategy event data
   * @returns {Object} The marker object for the chart
   */
  createStrategyMarker(eventData) {

    const markerId = `strategy-${eventData.event_id}`;
    const { shape, color, size, position, price } = this.getMarkerSpecification(eventData);

    return {
      id: markerId,
      time: eventData.event_time,
      price: price,
      shape: shape,
      position: position,
      color: color,
      size: size,
    };
  },

  /**
   * Adds or updates a strategy event marker in real-time.
   * @param {Object} eventData - The strategy event data from WebSocket
   */
  addStrategyEventMarker(eventData) {
  try {
    // Initialize markers array if it doesn't exist
    if (!state.strategyEventMarkers) {
      state.strategyEventMarkers = [];
    }

    // Create the marker
    const newMarker = this.createStrategyMarker(eventData);

    // Store the full event data for tooltip access
    state.strategyEventData.set(newMarker.id, eventData);

    // Add or update the marker in the array
    const existingIndex = state.strategyEventMarkers.findIndex(m => m.id === newMarker.id);

    if (existingIndex >= 0) {
      state.strategyEventMarkers[existingIndex] = newMarker;
    } else {
      state.strategyEventMarkers.push(newMarker);
    }

    // Update the chart markers
    this.updateAllMarkers();

  } catch (error) {
    logger.error('Error adding strategy event marker', {
      ctx: ['Chart', 'Strategy'],
      error: error.message,
      stack: error.stack,
      eventData: eventData
    });
  }
  },

  /**
   */
  hideStopLossLine() {
    if (state.stopLossLine) {
      state.stopLossLine.hide();
    }
  },

  /**
   * Shows the stop loss line manually at a specific price
   * @param {number} stopPrice - The stop loss price
   * @param {string} [color] - Optional color for the line
   */
  showStopLossLine(stopPrice, color = '#FF4444') {
    if (state.stopLossLine) {
      state.stopLossLine.show(stopPrice, color);
    }
  },

  /**
   * Applies canonical strategy lines coming from the server endpoint.
   * Expects lines object with keys: SL, TP, TSA, TSL (numeric or -1 when absent).
   * @param {{SL:number, TP:number, TSA:number, TSL:number, updated_at?:string, seq?:number}} lines
   * @param {{ orphaned?: boolean, instance?: string|null, is_alive?: boolean, heartbeat_at?: string }} meta
   */
  applyCanonicalStrategyLines(lines, meta = {}) {
    try {
      const { SL = -1, TP = -1, TSA = -1, TSL = -1 } = lines || {};
      const orphaned = !!meta.orphaned;

      // Choose colors (gray when orphaned)
      const stopColor   = orphaned ? '#777777' : '#FF4444';
      const targetColor = orphaned ? '#888888' : '#00FF00';
      const tsaColor    = orphaned ? '#999999' : '#FFFF00';

      // Stop Loss (use TSL price and orange color when trailing is active)
      const isTrailing = Number.isFinite(TSL) && TSL > 0;
      const stopLossPrice = isTrailing ? TSL : SL;
      const actualStopColor = isTrailing ? (orphaned ? '#AA6600' : '#FFA500') : stopColor; // Orange when trailing


      if (Number.isFinite(stopLossPrice) && stopLossPrice > 0 && state.stopLossLine) {
        state.stopLossLine.show(stopLossPrice, actualStopColor, isTrailing);
      } else if (state.stopLossLine) {
        state.stopLossLine.hide();
      }

      // Target

      if (Number.isFinite(TP) && TP > 0 && state.targetLine) {
        state.targetLine.show(TP, targetColor);
      } else if (state.targetLine) {
        state.targetLine.hide();
      }

      // Trailing Stop Activation
      if (Number.isFinite(TSA) && TSA > 0 && state.trailingStopActivationLine) {
        state.trailingStopActivationLine.show(TSA, tsaColor);
      } else if (state.trailingStopActivationLine) {
        state.trailingStopActivationLine.hide();
      }
    } catch (error) {
      logger.error('Error applying canonical strategy lines', { error: error.message });
    }
  },

  /**
   * Updates the visual state of strategy lines based on orphaned status.
   * @param {boolean} isOrphaned - Whether the strategy is orphaned/unhealthy
   * @param {Object} metadata - Additional metadata about the strategy state
   */
  updateStrategyLinesOrphanedState(isOrphaned, metadata) {
    try {
      // Only update visual appearance, don't change line values
      // Apply grey colors when orphaned, restore original colors when healthy
      if (state.stopLossLine?.isVisible()) {
        const color = isOrphaned ? '#888888' : '#FF4444';
        state.stopLossLine.show(state.stopLossLine.getPrice(), color);
      }

      if (state.targetLine?.isVisible()) {
        const color = isOrphaned ? '#888888' : '#00FF00';
        state.targetLine.show(state.targetLine.getPrice(), color);
      }

      if (state.trailingStopActivationLine?.isVisible()) {
        const color = isOrphaned ? '#888888' : '#FFFF00';
        state.trailingStopActivationLine.show(state.trailingStopActivationLine.getPrice(), color);
      }
    } catch (error) {
      logger.error('Error updating strategy lines orphaned state', { error: error.message });
    }
  },
};
