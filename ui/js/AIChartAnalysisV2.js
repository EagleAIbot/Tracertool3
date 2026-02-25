/*!
 * © 2025 EagleOracle Team. All rights reserved.
 *
 * AI Chart Analysis V2 - Advanced Features
 * =========================================
 * Extends AIChartAnalysis with:
 *   - Multi-Timeframe Confluence
 *   - Pattern Invalidation Alerts
 *   - Similar Historical Setups
 *   - Risk-Adjusted Position Sizing
 *   - Live Confidence Decay Tracking
 */

import { state, logger } from './state.js';
import { config } from './config.js';

// ============================================
// MULTI-TIMEFRAME CONFLUENCE SYSTEM
// ============================================

export const MultiTimeframeConfluence = {
  // Store predictions for each timeframe
  predictions: {
    '1h': null,
    '4h': null,
    '1d': null
  },
  
  // Timeframe weights (higher = more important)
  weights: {
    '1h': 0.3,
    '4h': 0.4,
    '1d': 0.3
  },

  /**
   * Update prediction for a specific timeframe
   */
  updatePrediction(timeframe, prediction) {
    this.predictions[timeframe] = {
      ...prediction,
      timestamp: Date.now()
    };
    logger.debug('MTF prediction updated', { ctx: ['MTF'], timeframe });
  },

  /**
   * Calculate confluence score across all timeframes
   * Returns 0-100 score and breakdown
   */
  calculateConfluence() {
    const active = Object.entries(this.predictions)
      .filter(([_, pred]) => pred !== null);
    
    if (active.length === 0) {
      return { score: 0, breakdown: {}, aligned: false, direction: null };
    }

    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;
    const breakdown = {};

    for (const [tf, pred] of active) {
      const weight = this.weights[tf] || 0.33;
      const confidence = pred.overall_confidence || pred.confidence || 0.5;
      
      if (pred.direction === 'UP') {
        bullishScore += weight * confidence;
      } else if (pred.direction === 'DOWN') {
        bearishScore += weight * confidence;
      }
      
      totalWeight += weight;
      breakdown[tf] = {
        direction: pred.direction,
        confidence: confidence,
        patterns: pred.patterns?.slice(0, 3) || []
      };
    }

    // Normalize scores
    const normalizedBull = totalWeight > 0 ? bullishScore / totalWeight : 0;
    const normalizedBear = totalWeight > 0 ? bearishScore / totalWeight : 0;
    
    // Determine overall direction and alignment
    const direction = normalizedBull > normalizedBear ? 'UP' : 'DOWN';
    const dominantScore = Math.max(normalizedBull, normalizedBear);
    const aligned = active.every(([_, p]) => p.direction === direction);
    
    // Confluence score: higher when all timeframes agree
    let score = dominantScore * 100;
    if (aligned && active.length >= 2) {
      score = Math.min(score * 1.2, 100); // 20% bonus for alignment
    }

    return {
      score: Math.round(score),
      breakdown,
      aligned,
      direction,
      timeframesAnalyzed: active.length
    };
  },

  /**
   * Get confluence status for display
   */
  getStatus() {
    const confluence = this.calculateConfluence();
    
    let status = 'NEUTRAL';
    let color = '#888888';
    
    if (confluence.score >= 80 && confluence.aligned) {
      status = 'STRONG CONFLUENCE';
      color = confluence.direction === 'UP' ? '#22c55e' : '#ef4444';
    } else if (confluence.score >= 60) {
      status = 'MODERATE CONFLUENCE';
      color = '#f59e0b';
    } else if (confluence.score >= 40) {
      status = 'WEAK CONFLUENCE';
      color = '#6b7280';
    } else {
      status = 'NO CONFLUENCE';
      color = '#6b7280';
    }

    return {
      ...confluence,
      status,
      color
    };
  },

  /**
   * Clear all predictions
   */
  clear() {
    this.predictions = { '1h': null, '4h': null, '1d': null };
  }
};

// ============================================
// PATTERN INVALIDATION ALERTS
// ============================================

export const PatternInvalidation = {
  // Active invalidation levels
  activeLevels: [],
  
  // Alert callbacks
  alertCallbacks: [],

  /**
   * Set invalidation level for current prediction
   */
  setInvalidationLevel(pattern, price, direction) {
    const level = {
      pattern,
      price,
      direction, // 'above' or 'below'
      createdAt: Date.now(),
      triggered: false
    };

    this.activeLevels.push(level);
    logger.info('Invalidation level set', { ctx: ['Invalidation'], pattern, price, direction });

    return level;
  },

  /**
   * Check current price against invalidation levels
   */
  checkPrice(currentPrice) {
    const alerts = [];

    for (const level of this.activeLevels) {
      if (level.triggered) continue;

      const distance = Math.abs(currentPrice - level.price) / level.price;
      const approaching = distance < 0.005; // Within 0.5%

      // Check if invalidated
      const invalidated = (level.direction === 'below' && currentPrice < level.price) ||
                         (level.direction === 'above' && currentPrice > level.price);

      if (invalidated) {
        level.triggered = true;
        alerts.push({
          type: 'INVALIDATED',
          pattern: level.pattern,
          price: level.price,
          message: `⚠️ ${level.pattern} INVALIDATED - Price broke ${level.direction} $${level.price.toLocaleString()}`
        });
      } else if (approaching) {
        alerts.push({
          type: 'WARNING',
          pattern: level.pattern,
          price: level.price,
          distance: (distance * 100).toFixed(2),
          message: `⚡ ${level.pattern} at risk - Price ${(distance * 100).toFixed(2)}% from invalidation`
        });
      }
    }

    // Fire callbacks for alerts
    alerts.forEach(alert => {
      this.alertCallbacks.forEach(cb => cb(alert));
    });

    return alerts;
  },

  /**
   * Register alert callback
   */
  onAlert(callback) {
    this.alertCallbacks.push(callback);
  },

  /**
   * Clear all invalidation levels
   */
  clear() {
    this.activeLevels = [];
  }
};

// ============================================
// SIMILAR HISTORICAL SETUPS FINDER
// ============================================

export const HistoricalSetups = {
  // Cache of historical patterns
  patternDatabase: [],

  /**
   * Add a completed setup to the database
   */
  addSetup(setup) {
    this.patternDatabase.push({
      ...setup,
      timestamp: Date.now()
    });

    // Keep only last 1000 setups
    if (this.patternDatabase.length > 1000) {
      this.patternDatabase.shift();
    }
  },

  /**
   * Find similar setups to current prediction
   */
  findSimilar(currentPrediction, maxResults = 5) {
    if (!currentPrediction || this.patternDatabase.length === 0) {
      return { similar: [], winRate: 0, avgReturn: 0 };
    }

    const currentPatterns = new Set(
      (currentPrediction.patterns || []).map(p => typeof p === 'string' ? p : p.name)
    );
    const currentDirection = currentPrediction.direction;

    // Score each historical setup by similarity
    const scored = this.patternDatabase.map(setup => {
      let score = 0;

      // Pattern overlap
      const setupPatterns = new Set(
        (setup.patterns || []).map(p => typeof p === 'string' ? p : p.name)
      );
      const overlap = [...currentPatterns].filter(p => setupPatterns.has(p)).length;
      score += overlap * 20;

      // Direction match
      if (setup.direction === currentDirection) score += 30;

      // Confidence similarity
      const confDiff = Math.abs(
        (setup.confidence || 0.5) - (currentPrediction.overall_confidence || 0.5)
      );
      score += (1 - confDiff) * 20;

      return { setup, score };
    });

    // Sort by score and take top results
    const similar = scored
      .filter(s => s.score > 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(s => s.setup);

    // Calculate win rate from similar setups
    const wins = similar.filter(s => s.outcome === 'WIN').length;
    const winRate = similar.length > 0 ? (wins / similar.length) * 100 : 0;

    // Calculate average return
    const returns = similar.filter(s => s.pnl !== undefined).map(s => s.pnl);
    const avgReturn = returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;

    return {
      similar,
      winRate: Math.round(winRate),
      avgReturn: avgReturn.toFixed(2),
      sampleSize: similar.length
    };
  },

  /**
   * Get formatted display for similar setups
   */
  getDisplayData(currentPrediction) {
    const result = this.findSimilar(currentPrediction);

    return {
      ...result,
      message: result.sampleSize > 0
        ? `Similar setups: ${result.sampleSize} found, ${result.winRate}% win rate`
        : 'No similar historical setups found'
    };
  }
};

// ============================================
// RISK-ADJUSTED POSITION SIZING
// ============================================

export const PositionSizer = {
  // Default account settings
  accountSize: 10000,
  maxRiskPercent: 2,

  /**
   * Configure position sizer
   */
  configure(settings) {
    if (settings.accountSize) this.accountSize = settings.accountSize;
    if (settings.maxRiskPercent) this.maxRiskPercent = settings.maxRiskPercent;
  },

  /**
   * Calculate position size based on trade quality
   * Higher quality = larger position
   */
  calculateSize(prediction, entryPrice, stopLoss) {
    const tradeQuality = prediction.trade_quality?.quality || 0.5;
    const hitTpProb = prediction.trade_quality?.hit_tp_prob || 0.5;

    // Base risk amount
    const baseRisk = this.accountSize * (this.maxRiskPercent / 100);

    // Adjust risk based on trade quality
    let riskMultiplier = 1.0;
    if (tradeQuality >= 0.8 && hitTpProb >= 0.7) {
      riskMultiplier = 1.0; // Full size for high quality
    } else if (tradeQuality >= 0.6 && hitTpProb >= 0.55) {
      riskMultiplier = 0.75; // 75% for medium-high
    } else if (tradeQuality >= 0.5) {
      riskMultiplier = 0.5; // 50% for medium
    } else if (tradeQuality >= 0.4) {
      riskMultiplier = 0.25; // 25% for low
    } else {
      riskMultiplier = 0; // Skip trade
    }

    const adjustedRisk = baseRisk * riskMultiplier;

    // Calculate position size from risk and stop distance
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const stopPercent = stopDistance / entryPrice;

    const positionSize = stopPercent > 0
      ? adjustedRisk / stopDistance
      : 0;

    const positionValue = positionSize * entryPrice;
    const leverage = positionValue / this.accountSize;

    return {
      positionSize: positionSize.toFixed(6),
      positionValue: positionValue.toFixed(2),
      riskAmount: adjustedRisk.toFixed(2),
      riskMultiplier,
      leverage: leverage.toFixed(2),
      recommendation: this.getRecommendation(riskMultiplier, tradeQuality)
    };
  },

  /**
   * Get trade recommendation based on quality
   */
  getRecommendation(multiplier, quality) {
    if (multiplier === 0) {
      return { action: 'SKIP', color: '#6b7280', reason: 'Trade quality too low' };
    } else if (multiplier >= 1.0) {
      return { action: 'FULL SIZE', color: '#22c55e', reason: 'High quality setup' };
    } else if (multiplier >= 0.75) {
      return { action: '75% SIZE', color: '#84cc16', reason: 'Good setup' };
    } else if (multiplier >= 0.5) {
      return { action: 'HALF SIZE', color: '#f59e0b', reason: 'Moderate setup' };
    } else {
      return { action: 'QUARTER SIZE', color: '#ef4444', reason: 'Low quality - reduce risk' };
    }
  }
};

// ============================================
// LIVE CONFIDENCE DECAY TRACKER
// ============================================

export const ConfidenceDecay = {
  // Active prediction tracking
  activePrediction: null,
  actualPrices: [],
  startTime: null,

  /**
   * Start tracking a new prediction
   */
  startTracking(prediction) {
    this.activePrediction = prediction;
    this.actualPrices = [];
    this.startTime = Date.now();

    logger.info('Started tracking prediction', { ctx: ['ConfidenceDecay'] });
  },

  /**
   * Update with new actual price
   */
  updatePrice(price, timestamp) {
    if (!this.activePrediction) return null;

    this.actualPrices.push({ price, timestamp });

    return this.calculateDecay();
  },

  /**
   * Calculate how well prediction is tracking
   */
  calculateDecay() {
    if (!this.activePrediction || this.actualPrices.length === 0) {
      return null;
    }

    const predictedPath = this.activePrediction.price_path || [];
    const barsElapsed = this.actualPrices.length;
    const totalBars = predictedPath.length;

    if (barsElapsed === 0 || totalBars === 0) return null;

    // Compare actual vs predicted for elapsed bars
    let totalError = 0;
    let maxError = 0;

    for (let i = 0; i < Math.min(barsElapsed, totalBars); i++) {
      const predicted = predictedPath[i];
      const actual = this.actualPrices[i]?.price;

      if (predicted && actual) {
        const error = Math.abs(predicted - actual) / actual;
        totalError += error;
        maxError = Math.max(maxError, error);
      }
    }

    const avgError = totalError / Math.min(barsElapsed, totalBars);

    // Calculate tracking score (100% = perfect, 0% = way off)
    const trackingScore = Math.max(0, 100 - (avgError * 1000));

    // Determine status
    let status, color, action;
    if (trackingScore >= 90) {
      status = 'ON TRACK';
      color = '#22c55e';
      action = 'Hold position';
    } else if (trackingScore >= 70) {
      status = 'MINOR DEVIATION';
      color = '#84cc16';
      action = 'Monitor closely';
    } else if (trackingScore >= 50) {
      status = 'DIVERGING';
      color = '#f59e0b';
      action = 'Consider reducing size';
    } else {
      status = 'OFF TRACK';
      color = '#ef4444';
      action = 'Consider early exit';
    }

    return {
      barsElapsed,
      totalBars,
      progress: ((barsElapsed / totalBars) * 100).toFixed(1),
      trackingScore: trackingScore.toFixed(1),
      avgError: (avgError * 100).toFixed(2),
      maxError: (maxError * 100).toFixed(2),
      status,
      color,
      action
    };
  },

  /**
   * Check if prediction has completed
   */
  isComplete() {
    if (!this.activePrediction) return false;
    const totalBars = this.activePrediction.price_path?.length || 24;
    return this.actualPrices.length >= totalBars;
  },

  /**
   * Get final outcome when prediction completes
   */
  getFinalOutcome() {
    if (!this.isComplete()) return null;

    const decay = this.calculateDecay();
    const prediction = this.activePrediction;

    const startPrice = this.actualPrices[0]?.price;
    const endPrice = this.actualPrices[this.actualPrices.length - 1]?.price;
    const actualDirection = endPrice > startPrice ? 'UP' : 'DOWN';
    const predictedDirection = prediction.direction;

    const directionCorrect = actualDirection === predictedDirection;
    const pnl = ((endPrice - startPrice) / startPrice) * 100;

    return {
      ...decay,
      directionCorrect,
      predictedDirection,
      actualDirection,
      pnl: pnl.toFixed(2),
      outcome: directionCorrect ? 'WIN' : 'LOSS'
    };
  },

  /**
   * Stop tracking and reset
   */
  stopTracking() {
    const outcome = this.getFinalOutcome();
    this.activePrediction = null;
    this.actualPrices = [];
    this.startTime = null;
    return outcome;
  }
};

// ============================================
// EXPORT ALL V2 FEATURES
// ============================================

export const AIChartAnalysisV2 = {
  MultiTimeframeConfluence,
  PatternInvalidation,
  HistoricalSetups,
  PositionSizer,
  ConfidenceDecay,

  /**
   * Initialize all V2 features
   */
  init(settings = {}) {
    if (settings.accountSize) {
      PositionSizer.configure({ accountSize: settings.accountSize });
    }

    // Set up invalidation alert handler
    PatternInvalidation.onAlert((alert) => {
      logger.warn(alert.message, { ctx: ['V2', 'Alert'] });
      // Could trigger notification here
    });

    logger.info('AI Chart Analysis V2 initialized', { ctx: ['V2'] });
  },

  /**
   * Process new prediction with all V2 features
   */
  processPrediction(prediction, timeframe = '1h') {
    // Update multi-timeframe
    MultiTimeframeConfluence.updatePrediction(timeframe, prediction);

    // Start confidence tracking
    ConfidenceDecay.startTracking(prediction);

    // Set invalidation levels from S/R
    const levels = prediction.levels || [];
    const direction = prediction.direction;

    if (direction === 'UP') {
      // For longs, invalidation is below nearest support
      const support = levels.find(l => l.type === 'support');
      if (support) {
        PatternInvalidation.setInvalidationLevel(
          prediction.patterns?.[0]?.name || 'Trade',
          support.price,
          'below'
        );
      }
    } else if (direction === 'DOWN') {
      // For shorts, invalidation is above nearest resistance
      const resistance = levels.find(l => l.type === 'resistance');
      if (resistance) {
        PatternInvalidation.setInvalidationLevel(
          prediction.patterns?.[0]?.name || 'Trade',
          resistance.price,
          'above'
        );
      }
    }

    // Get confluence status
    const confluence = MultiTimeframeConfluence.getStatus();

    // Get similar historical setups
    const historical = HistoricalSetups.getDisplayData(prediction);

    return {
      confluence,
      historical,
      invalidationLevels: PatternInvalidation.activeLevels
    };
  },

  /**
   * Update with new price tick
   */
  onPriceTick(price) {
    // Check invalidation levels
    const alerts = PatternInvalidation.checkPrice(price);

    // Update confidence decay
    const decay = ConfidenceDecay.updatePrice(price, Date.now());

    return { alerts, decay };
  }
};