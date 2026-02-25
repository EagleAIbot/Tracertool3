/*!
 * © 2025 EagleOracle Team. All rights reserved.
 *
 * AI Chart Analysis Integration - FULL TA REPLACEMENT
 * ====================================================
 * Connects TracerTool to the AI Chart Analysis prediction system.
 * Draws:
 *   - Price prediction path (cyan line, 24 bars ahead)
 *   - Support/Resistance levels (horizontal lines)
 *   - Pattern labels on chart
 *   - Confidence bands
 */

import { state, logger } from './state.js';
import { config } from './config.js';
import { HorizontalStrategyLine } from './HorizontalStrategyLine.js';

// ============================================
// S/R LEVEL LINE FACTORY FUNCTIONS
// ============================================

/**
 * Creates a Support level line (green, dashed)
 */
export const createSupportLine = (index) => new HorizontalStrategyLine({
  defaultColor: '#22c55e',  // Green
  label: `S${index + 1}`,
  fontSize: 10,
  labelPadding: 8,
  labelOffset: 5,
  lineWidth: 1.5,
  dashPattern: [4, 4],
  lineAlpha: 0.8
});

/**
 * Creates a Resistance level line (red, dashed)
 */
export const createResistanceLine = (index) => new HorizontalStrategyLine({
  defaultColor: '#ef4444',  // Red
  label: `R${index + 1}`,
  fontSize: 10,
  labelPadding: 8,
  labelOffset: 5,
  lineWidth: 1.5,
  dashPattern: [4, 4],
  lineAlpha: 0.8
});

/**
 * Creates a Take Profit line (green, solid, thicker)
 */
export const createTPLine = () => new HorizontalStrategyLine({
  defaultColor: '#22c55e',  // Green
  label: 'TP',
  fontSize: 11,
  labelPadding: 10,
  labelOffset: 8,
  lineWidth: 2.5,
  dashPattern: [8, 4],  // Longer dashes
  lineAlpha: 1.0
});

/**
 * Creates a Stop Loss line (red, solid, thicker)
 */
export const createSLLine = () => new HorizontalStrategyLine({
  defaultColor: '#ef4444',  // Red
  label: 'SL',
  fontSize: 11,
  labelPadding: 10,
  labelOffset: 8,
  lineWidth: 2.5,
  dashPattern: [8, 4],  // Longer dashes
  lineAlpha: 1.0
});

/**
 * AI Chart Analysis Manager
 * Handles WebSocket connection to AI prediction server and renders predictions
 */
export const AIChartAnalysis = {
  // Connection state
  ws: null,
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  reconnectDelay: 3000,

  // Prediction state
  currentPrediction: null,
  predictionHistory: [],
  predictionLineSeries: null,
  confidenceBandUpper: null,
  confidenceBandLower: null,

  // S/R Level lines (up to 8 levels)
  supportLines: [],
  resistanceLines: [],
  maxLevels: 8,

  // TP/SL Lines
  tpLine: null,
  slLine: null,

  // Pattern markers
  patternMarkers: [],

  // V3: SMC Zone lines and markers
  smcFvgZones: [],      // Fair Value Gap boxes
  smcObZones: [],       // Order Block boxes
  smcLiquidityZones: [], // Liquidity zone lines
  smcBosLines: [],      // BOS/CHoCH marker lines

  // Configuration
  serverUrl: 'wss://tracer.eagleailabs.com/ai-ws',
  enabled: false,
  minConfidence: 0.4,  // Lowered - model trained on Win Rate, not direction confidence
  minHistoricalAccuracy: 0.55,
  
  /**
   * Initialize AI Chart Analysis
   */
  initialize() {
    logger.info('Initializing AI Chart Analysis', { ctx: ['AIChart', 'Init'] });
    
    // Create chart series for predictions
    this.createPredictionSeries();
    
    // Load settings from localStorage
    this.loadSettings();

    // Always auto-connect
    this.connect();
  },
  
  /**
   * Create chart series for AI predictions and S/R levels
   */
  createPredictionSeries() {
    if (!state.chart) {
      logger.error('Chart not initialized', { ctx: ['AIChart', 'Init'] });
      return;
    }

    const { LineSeries, LineStyle } = window.LightweightCharts;

    // Main prediction line (dashed, cyan) - THE PRICE PATH
    this.predictionLineSeries = state.chart.addSeries(LineSeries, {
      color: 'rgba(0, 255, 255, 0.9)',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceLineVisible: false,
      title: 'AI Prediction',
    });

    // Confidence band - upper
    this.confidenceBandUpper = state.chart.addSeries(LineSeries, {
      color: 'rgba(0, 255, 255, 0.2)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Confidence band - lower
    this.confidenceBandLower = state.chart.addSeries(LineSeries, {
      color: 'rgba(0, 255, 255, 0.2)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // ============================================
    // CREATE S/R LEVEL LINES (up to 8)
    // ============================================
    // These are horizontal lines that show support/resistance
    // detected by the AI model

    this.supportLines = [];
    this.resistanceLines = [];

    for (let i = 0; i < this.maxLevels; i++) {
      // Create support line
      const supportLine = createSupportLine(i);
      this.supportLines.push(supportLine);
      state.candleSeries.attachPrimitive(supportLine);

      // Create resistance line
      const resistanceLine = createResistanceLine(i);
      this.resistanceLines.push(resistanceLine);
      state.candleSeries.attachPrimitive(resistanceLine);
    }

    // ============================================
    // CREATE TP/SL LINES
    // ============================================
    this.tpLine = createTPLine();
    this.slLine = createSLLine();
    state.candleSeries.attachPrimitive(this.tpLine);
    state.candleSeries.attachPrimitive(this.slLine);

    logger.info('AI prediction series, S/R lines, and TP/SL created', {
      ctx: ['AIChart', 'Init'],
      supportLines: this.supportLines.length,
      resistanceLines: this.resistanceLines.length
    });
  },
  
  /**
   * Connect to AI Chart Analysis WebSocket server
   */
  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.info('Already connected to AI server', { ctx: ['AIChart', 'WS'] });
      return;
    }
    
    logger.info('Connecting to AI Chart Analysis server', { 
      ctx: ['AIChart', 'WS'], 
      url: this.serverUrl 
    });
    
    try {
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.onopen = () => {
        logger.info('Connected to AI Chart Analysis server', { ctx: ['AIChart', 'WS'] });
        this.connected = true;
        this.reconnectAttempts = 0;
        
        // Subscribe to predictions for current symbol/timeframe
        this.subscribe();
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(JSON.parse(event.data));
      };
      
      this.ws.onerror = (error) => {
        logger.error('AI WebSocket error', { ctx: ['AIChart', 'WS'], error });
        this.connected = false;
      };
      
      this.ws.onclose = () => {
        logger.warning('AI WebSocket closed', { ctx: ['AIChart', 'WS'] });
        this.connected = false;
        this.scheduleReconnect();
      };
      
    } catch (error) {
      logger.error('Failed to connect to AI server', { ctx: ['AIChart', 'WS'], error });
      this.scheduleReconnect();
    }
  },
  
  /**
   * Subscribe to predictions for current symbol/timeframe
   */
  subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const subscription = {
      type: 'subscribe',
      symbol: config.symbol,
      timeframe: this.getTimeframeString()
    };
    
    this.ws.send(JSON.stringify(subscription));
    logger.info('Subscribed to AI predictions', { ctx: ['AIChart', 'WS'], ...subscription });
  },
  
  /**
   * Get timeframe string from current interval
   */
  getTimeframeString() {
    const intervalMinutes = config.currentInterval / 60;
    if (intervalMinutes < 60) return `${intervalMinutes}m`;
    if (intervalMinutes < 1440) return `${intervalMinutes / 60}h`;
    return `${intervalMinutes / 1440}d`;
  },

  /**
   * Handle incoming WebSocket message
   */
  handleMessage(message) {
    if (message.type === 'prediction') {
      // Server sends payload, not data
      this.handlePrediction(message.payload || message.data);
    } else if (message.type === 'error') {
      logger.error('AI server error', { ctx: ['AIChart', 'WS'], error: message.error });
    } else if (message.type === 'subscribed') {
      logger.info('Subscription confirmed', { ctx: ['AIChart', 'WS'] });
    }
  },

  /**
   * Handle incoming FULL TA prediction from AI model
   * Expected data format from predict_full_ta():
   * {
   *   patterns: [{name, confidence}, ...],
   *   levels: [{price, type, strength}, ...],
   *   price_path: [price1, price2, ...],
   *   path_confidence: [conf1, conf2, ...],
   *   direction: 'UP' | 'DOWN',
   *   direction_confidence: 0.85,
   *   overall_confidence: 0.72,
   *   prediction_bars: 24,
   *   timestamp: 1234567890
   * }
   */
  handlePrediction(data) {
    // Check if prediction meets display criteria
    const confidence = data.overall_confidence || data.confidence || 0;
    if (confidence < this.minConfidence) {
      logger.debug('Prediction filtered out - low confidence', {
        ctx: ['AIChart', 'Prediction'],
        confidence: confidence
      });
      return;
    }

    this.currentPrediction = data;
    this.predictionHistory.push(data);

    // Keep only last 100 predictions
    if (this.predictionHistory.length > 100) {
      this.predictionHistory.shift();
    }

    // Draw ALL TA elements on chart
    this.drawFullTA(data);

    logger.info('AI Full TA Prediction received', {
      ctx: ['AIChart', 'Prediction'],
      direction: data.direction,
      confidence: confidence,
      patterns: data.patterns?.length || 0,
      levels: data.levels?.length || 0,
      pathBars: data.prediction_bars || data.price_path?.length || 0
    });
  },

  /**
   * Check if prediction should be displayed
   */
  shouldDisplayPrediction(data) {
    const confidence = data.overall_confidence || data.confidence || 0;
    return confidence >= this.minConfidence;
  },

  /**
   * Draw FULL TA on chart - price path, S/R levels, patterns, SMC zones
   */
  drawFullTA(data) {
    // 1. Draw price path (the cyan prediction line)
    this.drawPricePath(data);

    // 2. Draw S/R levels (horizontal lines)
    this.drawSRLevels(data.levels || []);

    // 3. Draw TP/SL lines
    this.drawTPSLLines(data.trade_quality);

    // 4. V3: Draw SMC zones (FVG, OB, Liquidity, BOS/CHoCH)
    if (data.smc_zones) {
      this.drawSMCZones(data.smc_zones);
    }

    // 5. Update info panel with patterns and stats
    this.updatePredictionInfo(data);

    logger.info('Full TA drawn on chart', { ctx: ['AIChart', 'Draw'] });
  },

  /**
   * Draw TP (Take Profit) and SL (Stop Loss) horizontal lines
   */
  drawTPSLLines(tradeQuality) {
    // Hide existing lines first
    if (this.tpLine) this.tpLine.hide();
    if (this.slLine) this.slLine.hide();

    if (!tradeQuality || !tradeQuality.tp_price || !tradeQuality.sl_price) {
      return;
    }

    const tpPrice = tradeQuality.tp_price;
    const slPrice = tradeQuality.sl_price;

    // Draw TP line (green)
    if (this.tpLine && tpPrice) {
      this.tpLine.show(tpPrice, '#22c55e');
    }

    // Draw SL line (red)
    if (this.slLine && slPrice) {
      this.slLine.show(slPrice, '#ef4444');
    }

    logger.debug('TP/SL lines drawn', {
      ctx: ['AIChart', 'Draw'],
      tp: tpPrice,
      sl: slPrice,
      rr: tradeQuality.actual_rr
    });
  },

  /**
   * Draw the price prediction path (cyan line)
   */
  drawPricePath(data) {
    // Handle both old format (prediction_line) and new format (price_path)
    let pricePath = data.price_path || [];
    let pathConfidence = data.path_confidence || [];
    // Convert timestamp - server sends ISO string, we need Unix seconds
    let timestamp = data.timestamp;
    if (typeof timestamp === 'string') {
      timestamp = Math.floor(new Date(timestamp).getTime() / 1000);
    } else if (!timestamp) {
      timestamp = Math.floor(Date.now() / 1000);
    }
    const intervalSeconds = config.currentInterval || 3600; // Default 1h

    // If old format with prediction_line, use that
    if (data.prediction_line && data.prediction_line.length > 0) {
      const predictionData = data.prediction_line.map(point => ({
        time: point.time,
        value: point.price
      }));
      this.predictionLineSeries.setData(predictionData);

      // Draw confidence bands if available
      if (data.confidence_band) {
        const upperBand = data.prediction_line.map((point, i) => ({
          time: point.time,
          value: point.price * (1 + data.confidence_band[i])
        }));
        const lowerBand = data.prediction_line.map((point, i) => ({
          time: point.time,
          value: point.price * (1 - data.confidence_band[i])
        }));
        this.confidenceBandUpper.setData(upperBand);
        this.confidenceBandLower.setData(lowerBand);
      }
      return;
    }

    // New format: price_path is array of prices
    if (pricePath.length === 0) {
      logger.warning('No price path data', { ctx: ['AIChart', 'Draw'] });
      return;
    }

    // Convert price_path to chart format with timestamps
    const predictionData = pricePath.map((price, i) => ({
      time: timestamp + (i * intervalSeconds),
      value: price
    }));

    this.predictionLineSeries.setData(predictionData);

    // Draw confidence bands based on path_confidence
    if (pathConfidence.length > 0) {
      // Confidence decreases = wider bands
      // Use inverse of confidence as band width (e.g., 0.8 conf = 0.2 band)
      const upperBand = pricePath.map((price, i) => {
        const conf = pathConfidence[i] || 0.5;
        const bandWidth = (1 - conf) * 0.02; // Max 2% band at 0 confidence
        return {
          time: timestamp + (i * intervalSeconds),
          value: price * (1 + bandWidth)
        };
      });

      const lowerBand = pricePath.map((price, i) => {
        const conf = pathConfidence[i] || 0.5;
        const bandWidth = (1 - conf) * 0.02;
        return {
          time: timestamp + (i * intervalSeconds),
          value: price * (1 - bandWidth)
        };
      });

      this.confidenceBandUpper.setData(upperBand);
      this.confidenceBandLower.setData(lowerBand);
    }
  },

  /**
   * Draw Support/Resistance levels as horizontal lines
   */
  drawSRLevels(levels) {
    // First, hide all existing lines
    this.supportLines.forEach(line => line.hide());
    this.resistanceLines.forEach(line => line.hide());

    if (!levels || levels.length === 0) return;

    // Separate support and resistance levels
    const supports = levels.filter(l => l.type === 'support');
    const resistances = levels.filter(l => l.type === 'resistance');

    // Draw support levels (green)
    supports.forEach((level, i) => {
      if (i < this.supportLines.length) {
        // Color intensity based on strength
        const alpha = Math.min(0.4 + level.strength * 0.6, 1.0);
        const color = `rgba(34, 197, 94, ${alpha})`; // Green with variable alpha
        this.supportLines[i].show(level.price, color);
      }
    });

    // Draw resistance levels (red)
    resistances.forEach((level, i) => {
      if (i < this.resistanceLines.length) {
        const alpha = Math.min(0.4 + level.strength * 0.6, 1.0);
        const color = `rgba(239, 68, 68, ${alpha})`; // Red with variable alpha
        this.resistanceLines[i].show(level.price, color);
      }
    });

    logger.debug('S/R levels drawn', {
      ctx: ['AIChart', 'Draw'],
      supports: supports.length,
      resistances: resistances.length
    });
  },

  /**
   * V3: Draw Smart Money Concepts zones on chart
   * Includes FVG boxes, Order Blocks, Liquidity zones, and BOS/CHoCH lines
   */
  drawSMCZones(smcZones) {
    if (!smcZones) return;

    // Draw FVG zones as semi-transparent boxes
    this.drawFVGZones(smcZones.fvg || []);

    // Draw Order Blocks as highlighted boxes
    this.drawOrderBlocks(smcZones.ob || []);

    // Draw Liquidity zones
    this.drawLiquidityZones(smcZones.liquidity || []);

    // Draw BOS/CHoCH structure lines
    this.drawBOSChochLines(smcZones.bos_choch || []);

    logger.debug('SMC zones drawn', {
      ctx: ['AIChart', 'SMC'],
      fvg: smcZones.fvg?.length || 0,
      ob: smcZones.ob?.length || 0,
      liquidity: smcZones.liquidity?.length || 0,
      bos_choch: smcZones.bos_choch?.length || 0
    });
  },

  /**
   * Draw Fair Value Gap zones
   */
  drawFVGZones(fvgZones) {
    // Clear existing FVG markers from info panel
    const fvgContainer = document.getElementById('smc-fvg-info');
    if (fvgContainer) fvgContainer.innerHTML = '';

    if (!fvgZones || fvgZones.length === 0) return;

    // For now, we'll show FVG info in the panel since drawing boxes requires
    // custom primitive implementation. Full box drawing can be added later.
    const fvgInfo = fvgZones.map(fvg => {
      const type = fvg.type.includes('bullish') ? '🟢' : '🔴';
      return `${type} $${fvg.price_low.toLocaleString()} - $${fvg.price_high.toLocaleString()}`;
    }).join('<br>');

    if (fvgContainer) {
      fvgContainer.innerHTML = `<div class="smc-fvg-list">${fvgInfo}</div>`;
    }
  },

  /**
   * Draw Order Block zones
   */
  drawOrderBlocks(obZones) {
    const obContainer = document.getElementById('smc-ob-info');
    if (obContainer) obContainer.innerHTML = '';

    if (!obZones || obZones.length === 0) return;

    const obInfo = obZones.map(ob => {
      const type = ob.type.includes('bullish') ? '🟢 Demand' : '🔴 Supply';
      const strength = Math.round(ob.strength * 100);
      return `${type} $${ob.price_low.toLocaleString()} - $${ob.price_high.toLocaleString()} (${strength}%)`;
    }).join('<br>');

    if (obContainer) {
      obContainer.innerHTML = `<div class="smc-ob-list">${obInfo}</div>`;
    }
  },

  /**
   * Draw Liquidity zones
   */
  drawLiquidityZones(liquidityZones) {
    const liqContainer = document.getElementById('smc-liquidity-info');
    if (liqContainer) liqContainer.innerHTML = '';

    if (!liquidityZones || liquidityZones.length === 0) return;

    const liqInfo = liquidityZones.map(liq => {
      const type = liq.type.includes('high') ? '⬆️ Above' : '⬇️ Below';
      return `${type} $${liq.price_low.toLocaleString()} - $${liq.price_high.toLocaleString()}`;
    }).join('<br>');

    if (liqContainer) {
      liqContainer.innerHTML = `<div class="smc-liquidity-list">${liqInfo}</div>`;
    }
  },

  /**
   * Draw BOS/CHoCH structure lines
   */
  drawBOSChochLines(bosChochZones) {
    const structureContainer = document.getElementById('smc-structure-info');
    if (structureContainer) structureContainer.innerHTML = '';

    if (!bosChochZones || bosChochZones.length === 0) return;

    const structureInfo = bosChochZones.map(zone => {
      let label = '';
      let icon = '';
      if (zone.type.includes('bos_bullish')) {
        label = 'BOS ↑';
        icon = '🟢';
      } else if (zone.type.includes('bos_bearish')) {
        label = 'BOS ↓';
        icon = '🔴';
      } else if (zone.type.includes('choch_bullish')) {
        label = 'CHoCH ↑';
        icon = '🔄🟢';
      } else if (zone.type.includes('choch_bearish')) {
        label = 'CHoCH ↓';
        icon = '🔄🔴';
      }
      return `${icon} ${label} @ $${zone.price_high.toLocaleString()}`;
    }).join('<br>');

    if (structureContainer) {
      structureContainer.innerHTML = `<div class="smc-structure-list">${structureInfo}</div>`;
    }
  },

  /**
   * Update prediction info panel with FULL TA data
   */
  updatePredictionInfo(data) {
    const infoPanel = document.getElementById('ai-prediction-info');
    if (!infoPanel) return;

    const direction = data.direction || 'NEUTRAL';
    const directionColor = direction === 'UP' ? '#22c55e' :
                          direction === 'DOWN' ? '#ef4444' : '#888888';
    const directionArrow = direction === 'UP' ? '↑' :
                          direction === 'DOWN' ? '↓' : '→';

    const confidence = data.overall_confidence || data.confidence || 0;
    const directionConf = data.direction_confidence || confidence;

    // Format patterns for display
    const patterns = data.patterns || [];
    const patternHtml = patterns.length > 0
      ? patterns.slice(0, 5).map(p => {
          const name = typeof p === 'string' ? p : p.name;
          const conf = typeof p === 'object' ? ` (${(p.confidence * 100).toFixed(0)}%)` : '';
          return `<span class="ai-pattern-tag">${name.replace(/_/g, ' ')}${conf}</span>`;
        }).join(' ')
      : '<span class="ai-no-pattern">No patterns detected</span>';

    // Format levels for display
    const levels = data.levels || [];
    const supports = levels.filter(l => l.type === 'support');
    const resistances = levels.filter(l => l.type === 'resistance');

    infoPanel.innerHTML = `
      <div class="ai-prediction-header">
        <span class="ai-label">🤖 AI Full TA</span>
        <span class="ai-direction" style="color: ${directionColor}; font-weight: bold;">
          ${directionArrow} ${direction} (${(directionConf * 100).toFixed(0)}%)
        </span>
      </div>

      <div class="ai-prediction-stats">
        <div class="ai-stat">
          <span class="ai-stat-label">Overall Confidence</span>
          <span class="ai-stat-value">${(confidence * 100).toFixed(1)}%</span>
        </div>
        <div class="ai-stat">
          <span class="ai-stat-label">Prediction Bars</span>
          <span class="ai-stat-value">${data.prediction_bars || data.price_path?.length || 0}</span>
        </div>
      </div>

      <div class="ai-patterns-section">
        <div class="ai-section-label">📊 Detected Patterns:</div>
        <div class="ai-patterns-list">${patternHtml}</div>
      </div>

      <div class="ai-levels-section">
        <div class="ai-section-label">📈 Key Levels:</div>
        <div class="ai-levels-grid">
          <div class="ai-supports">
            <span class="ai-level-type" style="color: #22c55e;">Support:</span>
            ${supports.slice(0, 3).map(s =>
              `<span class="ai-level-price">$${s.price.toLocaleString()}</span>`
            ).join(' ') || '<span class="ai-no-level">-</span>'}
          </div>
          <div class="ai-resistances">
            <span class="ai-level-type" style="color: #ef4444;">Resistance:</span>
            ${resistances.slice(0, 3).map(r =>
              `<span class="ai-level-price">$${r.price.toLocaleString()}</span>`
            ).join(' ') || '<span class="ai-no-level">-</span>'}
          </div>
        </div>
      </div>

      ${this.renderSMCSection(data.smc_zones)}

      ${this.renderTradeQuality(data.trade_quality)}
    `;
  },

  /**
   * V3: Render Smart Money Concepts section
   */
  renderSMCSection(smcZones) {
    if (!smcZones) return '';

    const fvgCount = smcZones.fvg?.length || 0;
    const obCount = smcZones.ob?.length || 0;
    const liqCount = smcZones.liquidity?.length || 0;
    const bosCount = smcZones.bos_choch?.length || 0;

    // If no SMC data, don't render section
    if (fvgCount === 0 && obCount === 0 && liqCount === 0 && bosCount === 0) {
      return '';
    }

    // Build FVG summary
    const fvgSummary = smcZones.fvg?.slice(0, 3).map(fvg => {
      const type = fvg.type.includes('bullish') ? '🟢' : '🔴';
      return `${type} $${fvg.price_low.toLocaleString()} - $${fvg.price_high.toLocaleString()}`;
    }).join('<br>') || '--';

    // Build OB summary
    const obSummary = smcZones.ob?.slice(0, 3).map(ob => {
      const type = ob.type.includes('bullish') ? '🟢 Demand' : '🔴 Supply';
      const strength = Math.round(ob.strength * 100);
      return `${type} $${ob.price_low.toLocaleString()} (${strength}%)`;
    }).join('<br>') || '--';

    // Build Structure summary
    const structureSummary = smcZones.bos_choch?.slice(-2).map(zone => {
      if (zone.type.includes('bos_bullish')) return '🟢 BOS ↑';
      if (zone.type.includes('bos_bearish')) return '🔴 BOS ↓';
      if (zone.type.includes('choch_bullish')) return '🔄🟢 CHoCH ↑';
      if (zone.type.includes('choch_bearish')) return '🔄🔴 CHoCH ↓';
      return '';
    }).join(' ') || '--';

    // Build Liquidity summary
    const liqSummary = smcZones.liquidity?.slice(0, 2).map(liq => {
      const type = liq.type.includes('high') ? '⬆️' : '⬇️';
      return `${type} $${liq.price_high.toLocaleString()}`;
    }).join(' ') || '--';

    return `
      <div class="ai-smc-section" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div class="ai-section-label">🧠 Smart Money Concepts:</div>

        <div class="ai-smc-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 6px; font-size: 10px;">
          <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">
            <span style="color: #888; font-size: 9px; display: block;">📊 FVG (${fvgCount})</span>
            <span id="smc-fvg-info" style="color: #61dafb; font-size: 9px;">${fvgSummary}</span>
          </div>
          <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">
            <span style="color: #888; font-size: 9px; display: block;">📦 Order Blocks (${obCount})</span>
            <span id="smc-ob-info" style="color: #f59e0b; font-size: 9px;">${obSummary}</span>
          </div>
          <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">
            <span style="color: #888; font-size: 9px; display: block;">🔀 Structure</span>
            <span id="smc-structure-info" style="color: #a78bfa; font-size: 9px;">${structureSummary}</span>
          </div>
          <div style="background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">
            <span style="color: #888; font-size: 9px; display: block;">💧 Liquidity (${liqCount})</span>
            <span id="smc-liquidity-info" style="color: #38bdf8; font-size: 9px;">${liqSummary}</span>
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Render trade quality section with TP/SL probabilities and recommendation
   */
  renderTradeQuality(tradeQuality) {
    if (!tradeQuality) return '';

    const tpProb = (tradeQuality.hit_tp_prob * 100).toFixed(0);
    const slProb = (tradeQuality.hit_sl_prob * 100).toFixed(0);
    const actualRr = tradeQuality.actual_rr?.toFixed(2) || '0.00';
    const rec = tradeQuality.recommendation || 'UNKNOWN';

    // TP/SL prices
    const tpPrice = tradeQuality.tp_price ? `$${tradeQuality.tp_price.toLocaleString()}` : '--';
    const slPrice = tradeQuality.sl_price ? `$${tradeQuality.sl_price.toLocaleString()}` : '--';
    const entryPrice = tradeQuality.entry_price ? `$${tradeQuality.entry_price.toLocaleString()}` : '--';

    // Color coding for recommendation
    const recColors = {
      'STRONG': '#22c55e',   // Green
      'MODERATE': '#eab308', // Yellow
      'WEAK': '#f97316',     // Orange
      'SKIP': '#ef4444'      // Red
    };
    const recColor = recColors[rec] || '#888888';

    // Color for TP/SL based on probability
    const tpColor = tpProb >= 60 ? '#22c55e' : tpProb >= 40 ? '#eab308' : '#ef4444';
    const slColor = slProb <= 30 ? '#22c55e' : slProb <= 50 ? '#eab308' : '#ef4444';

    // Entry condition
    const entryCondition = tradeQuality.entry_condition || 'Enter at market';
    const entryTrigger = tradeQuality.entry_trigger || 'MARKET';

    // Entry trigger colors and icons
    const triggerStyles = {
      'PULLBACK': { color: '#22c55e', icon: '⬇️', bg: 'rgba(34,197,94,0.15)' },
      'RALLY': { color: '#ef4444', icon: '⬆️', bg: 'rgba(239,68,68,0.15)' },
      'BREAKOUT': { color: '#3b82f6', icon: '🚀', bg: 'rgba(59,130,246,0.15)' },
      'BREAKDOWN': { color: '#f97316', icon: '💥', bg: 'rgba(249,115,22,0.15)' },
      'AT_SUPPORT': { color: '#22c55e', icon: '✅', bg: 'rgba(34,197,94,0.15)' },
      'AT_RESISTANCE': { color: '#ef4444', icon: '✅', bg: 'rgba(239,68,68,0.15)' },
      'MARKET': { color: '#888', icon: '📍', bg: 'rgba(100,100,100,0.15)' }
    };
    const triggerStyle = triggerStyles[entryTrigger] || triggerStyles['MARKET'];

    return `
      <div class="ai-trade-quality-section" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.1);">
        <div class="ai-section-label">💰 Trade Setup:</div>

        <!-- ENTRY CONDITION - NEW -->
        <div class="ai-entry-condition" style="background: ${triggerStyle.bg}; padding: 8px; border-radius: 6px; margin: 8px 0; text-align: center; border: 1px solid ${triggerStyle.color}40;">
          <span style="font-size: 16px;">${triggerStyle.icon}</span>
          <span style="color: ${triggerStyle.color}; font-weight: bold; font-size: 11px; display: block; margin-top: 2px;">${entryCondition}</span>
        </div>

        <!-- TP/SL Price Levels -->
        <div class="ai-tpsl-prices" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 8px 0; text-align: center;">
          <div style="background: rgba(239,68,68,0.15); padding: 6px; border-radius: 4px; border: 1px solid rgba(239,68,68,0.3);">
            <span style="color: #888; font-size: 9px; display: block;">🛑 STOP LOSS</span>
            <span style="color: #ef4444; font-weight: bold; font-size: 12px;">${slPrice}</span>
          </div>
          <div style="background: rgba(100,100,100,0.15); padding: 6px; border-radius: 4px; border: 1px solid rgba(100,100,100,0.3);">
            <span style="color: #888; font-size: 9px; display: block;">📍 ENTRY</span>
            <span style="color: #61dafb; font-weight: bold; font-size: 12px;">${entryPrice}</span>
          </div>
          <div style="background: rgba(34,197,94,0.15); padding: 6px; border-radius: 4px; border: 1px solid rgba(34,197,94,0.3);">
            <span style="color: #888; font-size: 9px; display: block;">🎯 TAKE PROFIT</span>
            <span style="color: #22c55e; font-weight: bold; font-size: 12px;">${tpPrice}</span>
          </div>
        </div>

        <!-- Risk:Reward -->
        <div style="text-align: center; margin: 6px 0; padding: 4px; background: rgba(0,0,0,0.2); border-radius: 4px;">
          <span style="color: #888; font-size: 10px;">Risk:Reward → </span>
          <span style="color: #61dafb; font-weight: bold; font-size: 12px;">${actualRr}:1</span>
        </div>

        <!-- Probabilities -->
        <div class="ai-trade-quality-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 8px;">
          <div class="ai-tq-stat" style="background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px; text-align: center;">
            <span style="color: #888; font-size: 9px;">TP Hit Prob</span>
            <span style="color: ${tpColor}; font-weight: bold; display: block; font-size: 14px;">${tpProb}%</span>
          </div>
          <div class="ai-tq-stat" style="background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px; text-align: center;">
            <span style="color: #888; font-size: 9px;">SL Hit Prob</span>
            <span style="color: ${slColor}; font-weight: bold; display: block; font-size: 14px;">${slProb}%</span>
          </div>
        </div>

        <div class="ai-recommendation" style="margin-top: 8px; text-align: center; padding: 6px; background: rgba(0,0,0,0.3); border-radius: 6px; border: 1px solid ${recColor};">
          <span style="color: ${recColor}; font-weight: bold; font-size: 12px;">📊 ${rec} TRADE</span>
        </div>
      </div>
    `;
  },

  /**
   * Clear ALL TA elements from chart
   */
  clearPrediction() {
    // Clear price path
    this.predictionLineSeries?.setData([]);
    this.confidenceBandUpper?.setData([]);
    this.confidenceBandLower?.setData([]);

    // Hide all S/R lines
    this.supportLines.forEach(line => line.hide());
    this.resistanceLines.forEach(line => line.hide());

    // Hide TP/SL lines
    if (this.tpLine) this.tpLine.hide();
    if (this.slLine) this.slLine.hide();

    this.currentPrediction = null;

    const infoPanel = document.getElementById('ai-prediction-info');
    if (infoPanel) infoPanel.innerHTML = '';
  },

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached', { ctx: ['AIChart', 'WS'] });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

    logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`, {
      ctx: ['AIChart', 'WS']
    });

    setTimeout(() => this.connect(), delay);
  },

  /**
   * Disconnect from server
   */
  disconnect() {
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.clearPrediction();
    logger.info('Disconnected from AI server', { ctx: ['AIChart', 'WS'] });
  },

  /**
   * Toggle AI predictions on/off
   */
  toggle() {
    this.enabled = !this.enabled;
    this.saveSettings();

    if (this.enabled) {
      this.connect();
    } else {
      this.disconnect();
    }

    return this.enabled;
  },

  /**
   * Update settings
   */
  updateSettings(settings) {
    if (settings.serverUrl) this.serverUrl = settings.serverUrl;
    if (settings.minConfidence !== undefined) this.minConfidence = settings.minConfidence;
    if (settings.minHistoricalAccuracy !== undefined) {
      this.minHistoricalAccuracy = settings.minHistoricalAccuracy;
    }
    this.saveSettings();
  },

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    const settings = {
      enabled: this.enabled,
      serverUrl: this.serverUrl,
      minConfidence: this.minConfidence,
      minHistoricalAccuracy: this.minHistoricalAccuracy
    };
    localStorage.setItem('aiChartAnalysisSettings', JSON.stringify(settings));
  },

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem('aiChartAnalysisSettings');
      if (saved) {
        const settings = JSON.parse(saved);
        this.enabled = settings.enabled ?? false;
        this.serverUrl = settings.serverUrl ?? this.serverUrl;
        this.minConfidence = settings.minConfidence ?? 0.6;
        this.minHistoricalAccuracy = settings.minHistoricalAccuracy ?? 0.55;
      }
    } catch (e) {
      logger.warning('Failed to load AI settings', { ctx: ['AIChart', 'Settings'] });
    }
  },

  /**
   * Request prediction for current chart data
   */
  async requestPrediction() {
    if (!this.connected) {
      logger.warning('Not connected to AI server', { ctx: ['AIChart', 'Request'] });
      return null;
    }

    // Get current candle data from state.candleSeries (not state.candleData!)
    const allCandles = state.candleSeries?.data() || [];
    const candles = allCandles.slice(-200);
    if (candles.length < 50) {
      logger.warning('Not enough candle data for prediction', { ctx: ['AIChart', 'Request'], count: candles.length });
      return null;
    }

    // Format candles for API
    const formattedCandles = candles.map(c => ({
      timestamp: new Date(c.time * 1000).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));

    // Send prediction request (server expects payload wrapper)
    this.ws.send(JSON.stringify({
      type: 'predict',
      payload: {
        symbol: config.symbol,
        timeframe: this.getTimeframeString(),
        candles: formattedCandles
      }
    }));

    logger.info('Prediction requested', { ctx: ['AIChart', 'Request'] });
  },

  /**
   * Async version that returns a promise resolving when prediction is received
   */
  async requestPredictionAsync() {
    return new Promise((resolve) => {
      // Store the original handler
      const originalHandler = this.handlePrediction.bind(this);

      // Temporarily wrap to capture the result
      this.handlePrediction = (data) => {
        // Restore original handler
        this.handlePrediction = originalHandler;
        // Call original handler to draw on chart
        originalHandler(data);
        // Resolve with success
        resolve({ success: true, data: data });
      };

      // Set a timeout in case no response
      setTimeout(() => {
        this.handlePrediction = originalHandler;
        if (!this.connected) {
          resolve({ success: false, error: 'Not connected to AI server' });
        }
      }, 10000);

      // Send the request
      this.requestPrediction();
    });
  },

  /**
   * Get current prediction status
   */
  getStatus() {
    return {
      enabled: this.enabled,
      connected: this.connected,
      currentPrediction: this.currentPrediction,
      historyCount: this.predictionHistory.length,
      settings: {
        serverUrl: this.serverUrl,
        minConfidence: this.minConfidence,
        minHistoricalAccuracy: this.minHistoricalAccuracy
      }
    };
  }
};

