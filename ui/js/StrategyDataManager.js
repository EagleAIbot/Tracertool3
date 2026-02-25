/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { logger } from './state.js';
import { config } from './config.js';
import { ChartManager } from './ChartManager.js';
import { state } from './state.js';
import { instrumentObjectAuto } from './utils/TracingDecorator.js';


/**
 * Manages fetching and processing strategy-related data.
 */
const StrategyDataManagerBase = {
  _className: 'StrategyDataManager',

  // Private properties for event deduplication and staleness tracking
  _processedEventIds: new Set(),
  _deadInstances: new Set(),

  // Flag to prevent strategy line updates during historic event loading
  _loadingHistoricEvents: false,

  // Debouncing for historic event fetches
  _lastFetchParams: null,
  _lastFetchTime: 0,
  _fetchInProgress: false,

  // Strategy lines state tracking
  _currentStrategyLines: {
    SL: null,
    TP: null,
    ENTRY: null,
    TSA: null,
    TRAILING_STOP_ACTIVE: false,
    runtime_id: null,  // Per-process unique ID for detecting server restarts
    seq: null,         // Sequence number for ordering within same runtime
    lastUpdated: null,
    source: null, // 'event' | 'heartbeat' | null
    previousIsAlive: null  // Track previous alive state for transition detection
  },
  _stalenessCheckTimer: null,

  /**
   * Fetches available strategy instances from the API.
   * @returns {Promise<Array>} Array of strategy instance objects
   */
  async fetchStrategyInstances() {
    try {
      const url = `${config.localApiBase}/strategy_instances`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error fetching strategy instances: ${response.status}`);
      }

      const instances = await response.json();
      return instances;
    } catch (err) {
      logger.error("Error loading strategy instances", { ctx: ['Strategy', 'Server'], error: err.message });
      return [];
    }
  },

  /**
   * Fetches historic strategy events for a given time range and strategy instance.
   * @param {number} startTime - Start time in seconds since epoch
   * @param {number} endTime - End time in seconds since epoch
   * @param {string} strategyInstanceName - Name of the strategy instance
   */
  async fetchHistoricStrategyEvents(startTime, endTime, strategyInstanceName) {
    if (!startTime || !endTime || !strategyInstanceName) {
      logger.debug("Skipping strategy events fetch: invalid parameters", {
        ctx: ['Strategy', 'Server'],
        startTime, endTime, strategyInstanceName
      });
      return;
    }

    // Check if a fetch is already in progress
    if (this._fetchInProgress) {
      logger.debug("Fetch already in progress, skipping duplicate call", {
        ctx: ['Strategy', 'HistoricLoad']
      });
      return;
    }

    // Debounce: Check if this is a duplicate request within 2 seconds
    const currentParams = JSON.stringify({ startTime, endTime, strategyInstanceName });
    const now = Date.now();
    const debounceWindowMs = 2000;

    if (this._lastFetchParams === currentParams && (now - this._lastFetchTime) < debounceWindowMs) {
      logger.debug("Duplicate fetch request within debounce window, skipping", {
        ctx: ['Strategy', 'HistoricLoad'],
        timeSinceLastFetch: now - this._lastFetchTime
      });
      return;
    }

    // Mark fetch as in progress and update tracking
    this._fetchInProgress = true;
    this._lastFetchParams = currentParams;
    this._lastFetchTime = now;

    // Set flag to prevent strategy line updates during historic event loading
    this._loadingHistoricEvents = true;
    logger.debug("Historic event loading started - strategy line updates disabled", {
      ctx: ['Strategy', 'HistoricLoad']
    });

    try {
      const startTimeISO = new Date(startTime * 1000).toISOString();

      // Add one extra interval to end time to ensure we capture events at the boundary
      const currentInterval = config?.currentInterval || 60;
      const endTimeWithBuffer = endTime + currentInterval * 2;
      const endTimeISO = new Date(endTimeWithBuffer * 1000).toISOString();

      const url = `${config.localApiBase}/strategy-events?startTime=${encodeURIComponent(startTimeISO)}&endTime=${encodeURIComponent(endTimeISO)}&strategy_instance_name=${encodeURIComponent(strategyInstanceName)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error fetching strategy events: ${response.status}`);
      }

      const events = await response.json();
      logger.debug(`Received ${events.length} historic strategy events`, { ctx: ['Strategy', 'Server'] });
      ChartManager.displayStrategyMarkers(events);

    } catch (err) {
      logger.error("Error loading historic strategy events", { ctx: ['Strategy', 'Server'], error: err.message });
    } finally {
      // Re-enable strategy line updates after historic event loading is complete
      this._loadingHistoricEvents = false;
      this._fetchInProgress = false;
      logger.debug("Historic event loading completed - strategy line updates enabled", {
        ctx: ['Strategy', 'HistoricLoad']
      });
    }
  },

  /**
   * Handles incoming strategy event messages and updates chart markers in real-time.
   * @param {Object} eventData - The strategy event data from the WebSocket
   */
  handleStrategyEvent(eventData) {
    try {


      // Only process events for the currently selected strategy
      if (eventData.instance_name !== state.strategyInstanceName) {
        return;
      }

      // Skip processing if strategy is transitioning to prevent race conditions
      if (window.uiManager?._strategyTransitioning) {
        return;
      }

      // Check for duplicate event_id
      if (eventData.event_id && this._processedEventIds.has(eventData.event_id)) {
        return;
      }

      // Add event_id to processed set
      if (eventData.event_id) {
        this._processedEventIds.add(eventData.event_id);
        this._cleanupProcessedEventIds();
      }

      // Clear strategy lines if strategy_state is explicitly empty
      if (this._isStrategyStateEmpty(eventData.strategy_state)) {
        this._clearStrategyLinesState();
        ChartManager.clearStrategyLines();
      }
      // Update strategy lines from event if strategy_state has values
      else if (eventData.strategy_state && Object.keys(eventData.strategy_state).length > 0) {
        this._updateStrategyLinesFromEvent(eventData.strategy_state, {
          position: eventData.position,
          reason: eventData.reason,
          event_id: eventData.event_id,
          timestamp: eventData.event_time,
          instance_id: eventData.strategy_instance_id,
          instance_name: eventData.instance_name
        });
      }

      // Create marker for OPEN and CLOSE events only
      if (eventData.position === 'OPEN' || eventData.position === 'CLOSE') {
        ChartManager.addStrategyEventMarker(eventData);
      }

    } catch (error) {
      logger.error("Error handling strategy event", {
        ctx: ['Strategy', 'Event'],
        error: error.message,
        stack: error.stack,
        event_id: eventData.event_id,
        position: eventData.position
      });
    }
  },



  /**
   * Checks if heartbeat data is stale based on configured threshold.
   * @param {string} heartbeatTime - The heartbeat timestamp
   * @returns {boolean} True if data is stale
   */
  isDataStale(heartbeatTime) {
    if (!heartbeatTime) {
      return true;
    }

    const now = Date.now();
    const lastHeartbeat = new Date(heartbeatTime).getTime();
    const staleThreshold = config.strategy.heartbeatStalenessThreshold;
    const timeDiff = now - lastHeartbeat;
    const isStale = timeDiff > staleThreshold;

    return isStale;
  },

  /**
   * Handles incoming strategy heartbeat WebSocket messages.
   * @param {Object} payload - The heartbeat data from WebSocket
   */
  handleStrategyHeartbeat(payload) {
    try {
      // Only process heartbeat for the currently selected strategy
      if (payload.instance_name !== state.strategyInstanceName) {
        return;
      }

      const isStale = this.isDataStale(payload.heartbeat_at);

      // Update strategy health state
      state.currentStrategyHealth = {
        isAlive: !isStale,
        isOrphaned: isStale,
        lastHeartbeat: payload.heartbeat_at
      };

      // Detect alive state transition
      const previousIsAlive = this._currentStrategyLines.previousIsAlive;
      const aliveStateChanged = previousIsAlive !== null && previousIsAlive !== !isStale;
      this._currentStrategyLines.previousIsAlive = !isStale;

      // Process strategy lines from heartbeat if available

      if (payload.strategy_state && Object.keys(payload.strategy_state).length > 0) {
        // Force update on first heartbeat or when no lines are visible
        const forceUpdate = !this._hasCurrentStrategyLines() || this._currentStrategyLines.source === null;

        if (forceUpdate) {
          // Bypass gap detection for initial load
          const lines = this._convertStrategyStateToLines(payload.strategy_state);
          this._updateInternalLineState(payload.strategy_state, 'heartbeat', payload.heartbeat_at, payload.instance_id);

          ChartManager.applyCanonicalStrategyLines(lines, {
            instance: payload.instance_name,
            is_alive: !isStale,
            orphaned: isStale,
            heartbeat_at: payload.heartbeat_at
          });
        } else {
          this._updateStrategyLinesFromHeartbeat(payload.strategy_state, {
            instance: payload.instance_name,
            is_alive: !isStale,
            orphaned: isStale,
            heartbeat_at: payload.heartbeat_at
          });
        }
      } else if (isStale) {
        // If heartbeat is stale, grey out existing lines
        ChartManager.updateStrategyLinesOrphanedState(true, {
          instance: payload.instance_name,
          is_alive: false,
          heartbeat_at: payload.heartbeat_at
        });
      } else if (this._isStrategyStateEmpty(payload.strategy_state)) {
        // Heartbeat has empty strategy_state → no position, clear lines
        this._clearStrategyLinesState();
        ChartManager.clearStrategyLines();
      }

      // If alive state changed but strategy state didn't change, explicitly update orphaned status
      if (aliveStateChanged && !isStale && this._hasCurrentStrategyLines()) {
        ChartManager.updateStrategyLinesOrphanedState(false, {
          instance: payload.instance_name,
          is_alive: true,
          heartbeat_at: payload.heartbeat_at
        });
      }

      // Manage dead instances tracking
      if (isStale) {
        this._deadInstances.add(payload.instance_name);
      } else if (this._deadInstances.has(payload.instance_name)) {
        this._deadInstances.delete(payload.instance_name);
      }
    } catch (error) {
      logger.error("Error handling strategy heartbeat", { ctx: ['Strategy', 'Heartbeat'], error: error.message });
    }
  },

  /**
   * Updates strategy lines from strategy event data
   * @param {Object} strategyState - The strategy state from event
   * @param {Object} eventMetadata - Metadata about the event
   */
  _updateStrategyLinesFromEvent(strategyState, eventMetadata) {
    try {
      // Skip strategy line updates if we're still loading historic events
      if (this._loadingHistoricEvents) {
        return;
      }

      // Convert strategy state to lines format expected by ChartManager
      const lines = this._convertStrategyStateToLines(strategyState);

      // Update internal state tracking
      this._updateInternalLineState(strategyState, 'event', eventMetadata.timestamp, eventMetadata.instance_id);

      // Apply the lines to the chart with event metadata
      ChartManager.applyCanonicalStrategyLines(lines, {
        instance: eventMetadata.instance_name,
        is_alive: true,
        orphaned: false,
        source: 'event',
        event_id: eventMetadata.event_id
      });

    } catch (error) {
      logger.error("Error updating strategy lines from event", { ctx: ['Strategy', 'Lines'], error: error.message });
    }
  },

  /**
   * Updates strategy lines from heartbeat strategy_state data
   * @param {Object} strategyState - The strategy state from heartbeat
   * @param {Object} metadata - Metadata about the strategy instance
   */
  _updateStrategyLinesFromHeartbeat(strategyState, metadata) {
    try {
      // Skip strategy line updates if we're still loading historic events
      if (this._loadingHistoricEvents) {
        return;
      }

      // Check if we should update from heartbeat (gap detection)
      const shouldUpdate = this._shouldUpdateFromHeartbeat(strategyState, metadata);

      if (!shouldUpdate) {
        return;
      }

      // Convert strategy state to lines format expected by ChartManager
      const lines = this._convertStrategyStateToLines(strategyState);

      // Update internal state tracking
      this._updateInternalLineState(strategyState, 'heartbeat', metadata.heartbeat_at, metadata.instance_id);

      // Apply the lines to the chart
      ChartManager.applyCanonicalStrategyLines(lines, metadata);

    } catch (error) {
      logger.error("Error updating strategy lines from heartbeat", { ctx: ['Strategy', 'Lines'], error: error.message });
    }
  },

  /**
   * Converts strategy state to lines format for ChartManager
   * @param {Object} strategyState - The strategy state object
   * @returns {Object} Lines object for ChartManager
   */
  _convertStrategyStateToLines(strategyState) {
    const lines = {};

    // ChartManager expects raw numeric values, not objects
    if (strategyState.SL !== null && strategyState.SL !== undefined) {
      lines.SL = Number(strategyState.SL);
    }

    if (strategyState.TP !== null && strategyState.TP !== undefined) {
      lines.TP = Number(strategyState.TP);
    }

    if (strategyState.ENTRY !== null && strategyState.ENTRY !== undefined) {
      lines.ENTRY = Number(strategyState.ENTRY);
    }

    if (strategyState.TSA !== null && strategyState.TSA !== undefined) {
      lines.TSA = Number(strategyState.TSA);
    }

    return lines;
  },

  /**
   * Updates internal line state tracking
   * @param {Object} strategyState - The strategy state object
   * @param {string} source - Source of the update ('event' or 'heartbeat')
   * @param {string} timestamp - Timestamp of the update
   */
  _updateInternalLineState(strategyState, source, timestamp, runtime_id) {
    this._currentStrategyLines.SL = strategyState.SL || null;
    this._currentStrategyLines.TP = strategyState.TP || null;
    this._currentStrategyLines.ENTRY = strategyState.ENTRY || null;
    this._currentStrategyLines.TSA = strategyState.TSA || null;
    this._currentStrategyLines.TRAILING_STOP_ACTIVE = strategyState.TRAILING_STOP_ACTIVE || false;
    this._currentStrategyLines.runtime_id = runtime_id;
    this._currentStrategyLines.seq = strategyState.seq || null;
    this._currentStrategyLines.lastUpdated = timestamp || new Date().toISOString();
    this._currentStrategyLines.source = source;
  },

  /**
   * Checks if we currently have strategy lines
   * @returns {boolean} True if we have current strategy lines
   */
  _hasCurrentStrategyLines() {
    return this._currentStrategyLines.SL !== null ||
           this._currentStrategyLines.TP !== null ||
           this._currentStrategyLines.ENTRY !== null ||
           this._currentStrategyLines.TSA !== null;
  },

  /**
   * Determines if we should update lines from heartbeat
   * @param {Object} strategyState - Strategy state from heartbeat
   * @param {Object} metadata - Heartbeat metadata
   * @returns {boolean} True if we should update from heartbeat
   */
  _shouldUpdateFromHeartbeat(strategyState, metadata) {
    // LAYER 1: RUNTIME ID CHECK - Detect server restarts
    const currentRuntimeId = this._currentStrategyLines.runtime_id;
    const heartbeatRuntimeId = metadata.instance_id;

    if (currentRuntimeId && heartbeatRuntimeId && currentRuntimeId !== heartbeatRuntimeId) {
      // Different process - server restarted
      logger.info("Runtime ID changed - server restarted", { old_runtime: currentRuntimeId, new_runtime: heartbeatRuntimeId });

      // Use timestamp to verify new runtime is actually newer
      if (this._currentStrategyLines.lastUpdated && metadata.heartbeat_at) {
        const lastUpdateTime = new Date(this._currentStrategyLines.lastUpdated).getTime();
        const heartbeatTime = new Date(metadata.heartbeat_at).getTime();

        if (heartbeatTime >= lastUpdateTime) {
          return true;  // New process, newer timestamp → accept
        } else {
          return false;  // Old process heartbeat arriving late → reject
        }
      }

      // No timestamps available - accept new runtime
      return true;
    }

    // LAYER 2: SEQUENCE NUMBER CHECK (same runtime - most reliable)
    if (this._currentStrategyLines.seq !== null && strategyState.seq !== null) {
      if (strategyState.seq <= this._currentStrategyLines.seq) {
        return false;  // Not newer → reject
      }
    }

    // LAYER 3: TIMESTAMP FALLBACK (backward compat / no seq yet)
    if (this._currentStrategyLines.lastUpdated && metadata.heartbeat_at) {
      const lastUpdateTime = new Date(this._currentStrategyLines.lastUpdated).getTime();
      const heartbeatTime = new Date(metadata.heartbeat_at).getTime();

      if (heartbeatTime < lastUpdateTime) {
        return false;  // Older timestamp → reject
      }
    }

    // LAYER 4: EXISTING LOGIC - Initial load & state change checks
    if (!this._hasCurrentStrategyLines()) {
      return true;
    }

    const hasHeartbeatLines = strategyState &&
      Object.values(strategyState).some(v => v !== null && v !== undefined);

    if (hasHeartbeatLines && this._strategyStateChanged(strategyState)) {
      return true;
    }

    return false;  // No update needed
  },

  /**
   * Checks if the strategy state from heartbeat differs from our current state
   * @param {Object} heartbeatState - Strategy state from heartbeat
   * @returns {boolean} True if state has changed
   */
  _strategyStateChanged(heartbeatState) {
    const current = this._currentStrategyLines;

    return (
      current.SL !== heartbeatState.SL ||
      current.TP !== heartbeatState.TP ||
      current.ENTRY !== heartbeatState.ENTRY ||
      current.TSA !== heartbeatState.TSA ||
      current.TRAILING_STOP_ACTIVE !== heartbeatState.TRAILING_STOP_ACTIVE
    );
  },

  /**
   * Gets a snapshot of current strategy state for comparison
   * @returns {Object} Current strategy state snapshot
   */
  _getCurrentStateSnapshot() {
    return {
      SL: this._currentStrategyLines.SL,
      TP: this._currentStrategyLines.TP,
      ENTRY: this._currentStrategyLines.ENTRY,
      TSA: this._currentStrategyLines.TSA,
      TRAILING_STOP_ACTIVE: this._currentStrategyLines.TRAILING_STOP_ACTIVE
    };
  },

  /**
   * Clears all processed event IDs and strategy lines state. Called when strategy instance changes.
   */
  clearProcessedEvents() {
    this._processedEventIds.clear();
    this._clearStrategyLinesState();
    // Reset fetch tracking to allow new fetches for the new strategy
    this._lastFetchParams = null;
    this._lastFetchTime = 0;
    this._fetchInProgress = false;
  },

  /**
   * Checks if strategy state is empty or has all null/undefined values
   * @param {Object} strategyState - The strategy state to check
   * @returns {boolean} True if strategy state is empty or all values are null
   */
  _isStrategyStateEmpty(strategyState) {
    if (!strategyState || typeof strategyState !== 'object') {
      return false; // Missing or invalid - not explicitly empty
    }

    const keys = Object.keys(strategyState);

    // Empty object {} - explicitly empty
    if (keys.length === 0) {
      return true;
    }

    // Check if all line values (SL, TP, ENTRY, TSA) are null/undefined
    const lineKeys = ['SL', 'TP', 'ENTRY', 'TSA'];
    const hasAnyLineValue = lineKeys.some(key => {
      const value = strategyState[key];
      return value !== null && value !== undefined;
    });

    return !hasAnyLineValue; // All line values are null/undefined
  },

  /**
   * Clears the internal strategy lines state
   */
  _clearStrategyLinesState() {
    this._currentStrategyLines.SL = null;
    this._currentStrategyLines.TP = null;
    this._currentStrategyLines.ENTRY = null;
    this._currentStrategyLines.TSA = null;
    this._currentStrategyLines.TRAILING_STOP_ACTIVE = false;
    this._currentStrategyLines.runtime_id = null;
    this._currentStrategyLines.seq = null;
    this._currentStrategyLines.lastUpdated = null;
    this._currentStrategyLines.source = null;
    this._currentStrategyLines.previousIsAlive = null;
  },

  /**
   * Starts the periodic staleness check timer.
   */
  startStalenessCheck() {
    this.stopStalenessCheck();

    const intervalMs = config.strategy.heartbeatStalenessThreshold / 2;
    this._stalenessCheckTimer = setInterval(() => {
      this.checkCurrentStrategyStale();
    }, intervalMs);
  },

  /**
   * Stops the periodic staleness check timer.
   */
  stopStalenessCheck() {
    if (this._stalenessCheckTimer) {
      clearInterval(this._stalenessCheckTimer);
      this._stalenessCheckTimer = null;
    }
  },

  /**
   * Checks if the current strategy is stale and updates UI accordingly.
   */
  checkCurrentStrategyStale() {
    if (!state.strategyInstanceName || !state.currentStrategyHealth.lastHeartbeat) {
      return;
    }

    const isStale = this.isDataStale(state.currentStrategyHealth.lastHeartbeat);
    const wasStale = state.currentStrategyHealth.isOrphaned;

    // Only update if staleness state changed
    if (isStale !== wasStale) {
      // Update strategy health state
      state.currentStrategyHealth.isOrphaned = isStale;
      state.currentStrategyHealth.isAlive = state.currentStrategyHealth.isAlive && !isStale;

      // Update previousIsAlive to reflect the new stale state
      this._currentStrategyLines.previousIsAlive = !isStale;

      // Update visual state of strategy lines
      ChartManager.updateStrategyLinesOrphanedState(isStale, {
        instance: state.strategyInstanceName,
        is_alive: state.currentStrategyHealth.isAlive,
        heartbeat_at: state.currentStrategyHealth.lastHeartbeat
      });
    }
  },

  /**
   * Cleanup mechanism for processed event IDs set.
   * When set exceeds 1000 items, removes oldest 200 items.
   * @private
   */
  _cleanupProcessedEventIds() {
    if (this._processedEventIds.size > 1000) {
      const eventIdsArray = Array.from(this._processedEventIds);
      const toKeep = eventIdsArray.slice(200);
      this._processedEventIds = new Set(toKeep);
    }
  }

};

// Create traced version with auto-discovery (including private methods)
export const StrategyDataManager = instrumentObjectAuto(StrategyDataManagerBase, null, { includePrivate: true });
