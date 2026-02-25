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
import { filterForLastInBar, floorToBucket, parseTimeToSecondsUTC } from './utils.js';
/**
 * Manages fetching and processing prediction data.
 */

export const PredictionDataManager = {  /**

  * Fetches historical prediction data from the local API for a given time range.
   * @param {string | null} startTime - The start RFC3339 timestamp.
   * @param {string | null} endTime - The end RFC3339 timestamp.
   */
  async fetchHistorical(startTime, endTime) {
    if (!startTime || !endTime) {
        // Reset state to empty arrays to prevent null value errors
        this.resetState();
        return;
    }

    try {

      // Extend end time to include future predictions
      const predictionTimeframeSeconds = parseFloat(config.predictionTimeframe) * 3600;
      const adjustedEndTimeSec = endTime + predictionTimeframeSeconds;

      const startTimeISO = new Date(startTime * 1000).toISOString();
      const adjustedEndTimeSecISO = new Date(adjustedEndTimeSec * 1000).toISOString();

      const url = `${config.localApiBase}/historic-predictions?startTime=${encodeURIComponent(startTimeISO)}&endTime=${encodeURIComponent(adjustedEndTimeSecISO)}&timeframe=${config.predictionTimeframe}&version=${config.predictionVersion}&symbol=${config.apiSymbol}`;
      const predictionRes = await fetch(url);

      if (!predictionRes.ok) {
        throw new Error(`HTTP error fetching predictions: ${predictionRes.status}`);
      }

      const predictions = await predictionRes.json();

      if (predictions.length > 0) {

        let filteredPredictions;
        if (state.forceBarAlignment) {
          // filteredPredictions = filterForFirstInBar(predictions, config.currentInterval);
          filteredPredictions = filterForLastInBar(predictions, config.currentInterval);
        } else {
          filteredPredictions = predictions;
        }

        // Clear existing predictions
        this.resetState();
        state.predictions = filteredPredictions;

        // Process all predictions with additional error handling
        const processedPredictions = filteredPredictions
          .filter(pred => pred && typeof pred === 'object') // Ensure prediction is a valid object
          .map(row => {
            try {
              return this.calcDerivedMeasures(row);
            } catch (err) {
              logger.error('Error processing prediction', { ctx: ['Predictions', 'Processing'], error: err.message });
              return null;
            }
          })
          .filter(Boolean); // Remove any null/undefined values

        // Update state with new predictions
        state.predictions = processedPredictions;

        // Store the latest prediction globally for armed strategy display
        if (processedPredictions.length > 0) {
          window.latestPrediction = processedPredictions[processedPredictions.length - 1];
        }

        // Send batch update to ChartManager
        ChartManager.updateAllPredictions(processedPredictions);
      }
    } catch (err) {
      logger.error('Error loading historic predictions', { ctx: ['Predictions', 'Server'], error: err.message });
    }
  },


  /**
   * Processes a single prediction's data (no visual updates)
   * @param {string} prediction_time - RFC3339 timestamp string when the prediction was made (e.g., "2025-05-09T12:34:56Z")
   * @param {number|string} prediction_price - The price when the prediction was made
   * @param {string} predicted_time - RFC3339 timestamp string for which the prediction is made (e.g., "2025-05-09T13:34:56Z")
   * @param {number|string} predicted_price - The predicted price
   * @param {string} prediction_timeframe - The timeframe for the prediction (e.g., "1", "2", "4")
   * @param {number|string} binance_trade_price_predicted - The binance trade price predicted
   * @returns {Object|null} The processed prediction object or null if invalid
   */
  calcDerivedMeasures(row) {

    const predicted_move = row.predicted_price - row.prediction_price;
    const predicted_move_percentage = (predicted_move / row.prediction_price) * 100;

    const { score, type } = this.getMapeScore(row);
    // Return processed prediction object with all available metadata
    return {
      ...row,
      predicted_move: predicted_move,
      predicted_move_percentage: predicted_move_percentage,
      mape_score: score,
      mape_score_type: type,
    };
  },

  /**
   * Calculate the Mean Absolute Percentage Error (MAPE) for the current prediction
   * using a rolling window of the last N predictions
   * @param {Object} prediction_id - The current prediction to calculate MAPE for
   * @param {number} [windowSize=null] - The size of the rolling window (defaults to state.mapeWindowSize if null)
   * @returns {number|null} - The MAPE score or null if not enough data
   */
  calculateMAPE(prediction_id, windowSize = null) {

    // Ensure we have the necessary data in state.predictions
    if (!state.predictions || state.predictions.length === 0) {
      return null;
    }

    // Find the index of the current prediction in the state.predictions array
    const currentIndex = state.predictions.findIndex(p => p.id === prediction_id);

    if (currentIndex === -1) {
      // Current prediction not found in the array
      return null;
    }

    // Use provided windowSize or fall back to state.mapeWindowSize
    const actualWindowSize = windowSize !== null ? windowSize : state.mapeWindowSize;

    // Get up to N predictions including and before the current one
    const startIndex = Math.max(0, currentIndex - (actualWindowSize - 1));
    const windowPredictions = state.predictions.slice(startIndex, currentIndex + 1);

    // Filter predictions that have both predicted_price and binance_trade_price_predicted
    const validPredictions = windowPredictions.filter(p => {
      const isValid = p.predicted_price !== null &&
        p.predicted_price !== undefined &&
        p.binance_trade_price_predicted !== null &&
        p.binance_trade_price_predicted !== undefined;

      return isValid;
    });


    // If we don't have any valid predictions, return null
    if (validPredictions.length < actualWindowSize) {
      return null;
    }

    // Calculate the sum of absolute percentage errors
    let apeValues = [];
    const sumAPE = validPredictions.reduce((sum, p) => {
      const actual = p.binance_trade_price_predicted;
      const predicted = p.predicted_price;

      // Avoid division by zero
      if (actual === 0) {
        return sum;
      }

      const ape = Math.abs((actual - predicted) / actual) * 100;
      apeValues.push({id: p.id, actual, predicted, ape});
      return sum + ape;
    }, 0);


    // Calculate MAPE
    const mape = sumAPE / validPredictions.length;

    state.lastMapeScore = mape;

    return mape;
  },

  /**
   * Handles a live prediction message from the WebSocket.
   * @param {object} data - The prediction data object from the WebSocket message.
   */
  handlePredictionMessage(data) {

    try {

      if (data.newly_enriched) {
        // Filter enriched predictions to only include the active timeframe
        const filteredEnriched = data.newly_enriched.filter(enriched => {
          const predictionTimeframe = String(enriched.prediction_timeframe);
          const activeTimeframe = String(config.predictionTimeframe);
          return predictionTimeframe === activeTimeframe;
        });

        // First update each prediction with the enriched data
        filteredEnriched.forEach(enriched => {
          const existingPredictionIndex = state.predictions.findIndex(p => p.id === enriched.id);

          // May not find the prediction if it has been filtered due to bar alignment
          if (existingPredictionIndex !== -1) {
            state.predictions[existingPredictionIndex] = enriched;
            state.predictions[existingPredictionIndex] = this.calcDerivedMeasures(enriched);
            ChartManager.updateDerivedMeasures(state.predictions[existingPredictionIndex]);
          }
        });

        // Then update all future metrics that needs Update any metrics that are dependend on predictions that have been enriched
        // Get the ID of the last enriched prediction
        if (filteredEnriched.length > 0) {
          const lastEnrichedId = filteredEnriched.at(-1)?.id;
          const lastExistingPredictionIndex = state.predictions.findIndex(p => p.id === lastEnrichedId);

          if (lastExistingPredictionIndex !== -1) {
            // Update derived measures for predictions that follows the last enriched one
            for (let i = lastExistingPredictionIndex + 1; i < state.predictions.length; i++) {
              state.predictions[i] = this.calcDerivedMeasures(state.predictions[i]);
              ChartManager.updateDerivedMeasures(state.predictions[i]);
            }
          }
        }

      }

      if (data.latest_prediction) {
        // Filter to only process predictions for the active timeframe
        const predictionTimeframe = String(data.latest_prediction.prediction_timeframe);
        const activeTimeframe = String(config.predictionTimeframe);

        logger.debug('Received prediction via WebSocket', {
          ctx: ['Predictions', 'WebSocket'],
          predictionTimeframe,
          activeTimeframe,
          predictedPrice: data.latest_prediction.predicted_price,
          isReloading: state.isReloading
        });

        if (predictionTimeframe !== activeTimeframe) {
          logger.debug('Skipping prediction - timeframe mismatch', { ctx: ['Predictions', 'WebSocket'], predictionTimeframe, activeTimeframe });
          return;
        }

        // Store latest prediction globally for armed strategy display
        window.latestPrediction = data.latest_prediction;

        // Calculate derived measures for the new prediction
        const processedPrediction = this.calcDerivedMeasures(data.latest_prediction);

        if (state.forceBarAlignment) {
          logger.debug('Adding prediction with bar alignment', { ctx: ['Predictions', 'WebSocket'], predictedTime: processedPrediction.predicted_time });
          this.updatePredictionInState(processedPrediction);
        } else {
          logger.debug('Adding prediction without bar alignment', { ctx: ['Predictions', 'WebSocket'], predictedTime: processedPrediction.predicted_time });
          state.predictions.push(processedPrediction);
          ChartManager.addNewPrediction(processedPrediction);
        }
      }
    } catch (e) {
      logger.error('Error processing prediction WS message', { ctx: ['Predictions', 'WebSocket'], error: e.message });
    }
  },

  /**
   * Updates state.predictions with a new prediction, either replacing the last one if in the same bucket
   * or adding it as a new entry
   * @param {Object} newPrediction - The new prediction to add or replace with
   * @returns {Object} The updated prediction (either new or replaced)
   */
  updatePredictionInState(newPrediction) {

    // If there are no predictions yet, just add it
    if (state.predictions.length === 0) {
      state.predictions.push(newPrediction);
      return newPrediction;
    }

    // Get the last prediction in the state
    const lastPrediction = state.predictions[state.predictions.length - 1];

    // Check if they're in the same bucket
    const newBucket = floorToBucket(parseTimeToSecondsUTC(newPrediction.predicted_time) * 1000, config.currentInterval);
    const lastBucket = floorToBucket(parseTimeToSecondsUTC(lastPrediction.predicted_time) * 1000, config.currentInterval);

    if (newBucket === lastBucket) {
      // Replace the last prediction
      state.predictions[state.predictions.length - 1] = newPrediction;
      ChartManager.updateLatestPrediction(newPrediction);
    } else {
      // Add as a new prediction
      state.predictions.push(newPrediction);
      ChartManager.addNewPrediction(newPrediction);
    }

    return newPrediction;
  },

  /**
   * Resets the prediction-related state variables.
   */
  resetState() {
    // Clear existing predictions
    state.predictions = [];
    state.lastMapeScore = null;
  },

  /**
   * Determines the MAPE score for a given prediction.
   * It either calculates a new one or uses the last known score as a fallback.
   * @param {Object} prediction - The prediction object.
   * @returns {{score: number|null, type: string|null}} The calculated MAPE score and its type.
   */
  getMapeScore(prediction) {

    // Calculate a new MAPE score if we have the actual trade price data.
    if (prediction.predicted_price != null && prediction.binance_trade_price_predicted != null) {
      return { score: this.calculateMAPE(prediction.id), type: 'calculated' };
    }

    // Fallback to the last calculated score if no actual price is available yet.
    if (prediction.predicted_price != null) {
      return { score: state.lastMapeScore, type: 'fallback' };
    }

    // Return null if no score can be determined.
    return { score: null, type: null };
  },

  /**
   * Recalculates MAPE scores for all predictions currently in the state.
   * This is a performant alternative to a full reload when only the window size changes.
   * @returns {Array} The predictions array with updated MAPE scores.
   */
  reprocessMapeScores() {
    if (!state.predictions || state.predictions.length === 0) {
      return [];
    }

    // IMPORTANT: Reset the last known score to ensure calculations start fresh.
    state.lastMapeScore = null;

    // Map over existing predictions to create a new array with updated scores.
    const reprocessedPredictions = state.predictions.map(prediction => {
      const newPrediction = { ...prediction };
      // Use the new centralized function to get the score.
      const { score, type } = this.getMapeScore(prediction);
      newPrediction.mape_score = score;
      newPrediction.mape_score_type = type;
      return newPrediction;
    });

    // Replace the old predictions array with the newly processed one.
    state.predictions = reprocessedPredictions;

    return reprocessedPredictions;
  }

};
