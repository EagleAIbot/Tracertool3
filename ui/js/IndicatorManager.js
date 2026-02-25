/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 * Indicator Manager - Fetches Binance data and calculates technical indicators
 */
import { logger } from './state.js';
import { config } from './config.js';

/**
 * Manages fetching and calculation of technical indicators for signal filtering.
 */
export const IndicatorManager = {
  // Cached indicator values
  _cache: null,
  _cacheTime: null,
  _cacheDuration: 60 * 1000, // 1 minute cache

  /**
   * Fetches 1H candles from Binance and calculates current indicators
   * @returns {Promise<Object|null>} Current indicator values or null if error
   */
  async getCurrentIndicators() {
    // Check cache first
    const now = Date.now();
    if (this._cache && this._cacheTime && (now - this._cacheTime) < this._cacheDuration) {
      return this._cache;
    }

    try {
      // Fetch enough 1H candles for indicator calculations (need 50+ for EMA)
      const url = `/api/binance-klines?symbol=${config.symbol || 'BTCUSDT'}&interval=1h&limit=100`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error fetching candles: ${res.status}`);
      const data = await res.json();

      if (!Array.isArray(data) || data.length < 30) {
        logger.warning('Insufficient candle data for indicator calculation', { ctx: ['Indicators'] });
        return null;
      }

      // Extract OHLCV data
      const candles = data.map(d => ({
        time: d[0] / 1000,
        open: +d[1],
        high: +d[2],
        low: +d[3],
        close: +d[4],
        volume: +d[5]
      }));

      const closes = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);

      // Calculate all indicators
      const indicators = {
        rsi: this.calculateRSI(closes, 14),
        macdHistogram: this.calculateMACDHistogram(closes, 12, 26, 9),
        ema9: this.calculateEMA(closes, 9),
        ema21: this.calculateEMA(closes, 21),
        adx: this.calculateADX(highs, lows, closes, 14),
        currentPrice: closes[closes.length - 1]
      };

      // Cache the result
      this._cache = indicators;
      this._cacheTime = now;

      logger.debug('Indicators calculated', { 
        ctx: ['Indicators'], 
        rsi: indicators.rsi?.toFixed(1),
        macd: indicators.macdHistogram?.toFixed(2),
        adx: indicators.adx?.toFixed(1)
      });

      return indicators;
    } catch (err) {
      logger.error('Error fetching/calculating indicators', { ctx: ['Indicators'], error: err.message });
      return null;
    }
  },

  // ============================================
  // INDICATOR CALCULATIONS - EXACT MATCH TO ORACLE API (predictions-api.cjs)
  // ============================================

  /**
   * EMA Array - Exponential Moving Average (matches Oracle API exactly)
   */
  _calculateEMAArray(closes, period) {
    const result = [];
    const multiplier = 2 / (period + 1);
    let ema = null;

    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else if (i === period - 1) {
        // First EMA is SMA
        const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
        ema = sum / period;
        result.push(ema);
      } else {
        ema = (closes[i] - ema) * multiplier + ema;
        result.push(ema);
      }
    }
    return result;
  },

  /**
   * Get last valid EMA value
   */
  calculateEMA(data, period) {
    const emaArray = this._calculateEMAArray(data, period);
    for (let i = emaArray.length - 1; i >= 0; i--) {
      if (emaArray[i] !== null) return emaArray[i];
    }
    return null;
  },

  /**
   * RSI - Relative Strength Index (matches Oracle API exactly)
   */
  calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;

    const gains = [];
    const losses = [];

    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        gains.push(0);
        losses.push(0);
      } else {
        const change = closes[i] - closes[i - 1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
      }
    }

    // Use simple average for the last period (matches Oracle simplified approach)
    const lastIdx = closes.length - 1;
    const avgGain = gains.slice(lastIdx - period + 1, lastIdx + 1).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(lastIdx - period + 1, lastIdx + 1).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },

  /**
   * MACD Histogram (matches Oracle API exactly)
   */
  calculateMACDHistogram(closes, fast = 12, slow = 26, signal = 9) {
    if (closes.length < 35) return null;

    const fastEMA = this._calculateEMAArray(closes, fast);
    const slowEMA = this._calculateEMAArray(closes, slow);

    // Build MACD line
    const macdLine = fastEMA.map((f, i) => {
      if (f === null || slowEMA[i] === null) return null;
      return f - slowEMA[i];
    });

    // Get valid MACD values for signal calculation
    const validMacd = macdLine.filter(v => v !== null);
    if (validMacd.length < signal) return null;

    const signalEMA = this._calculateEMAArray(validMacd, signal);

    // Get last valid values
    const lastMacd = validMacd[validMacd.length - 1];
    const lastSignal = signalEMA[signalEMA.length - 1];

    if (lastSignal === null) return null;
    return lastMacd - lastSignal;
  },

  /**
   * ATR - Average True Range (needed for ADX)
   */
  _calculateATR(highs, lows, closes, period) {
    const result = [];
    const trueRanges = [];

    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        trueRanges.push(highs[i] - lows[i]);
        result.push(null);
      } else {
        const tr = Math.max(
          highs[i] - lows[i],
          Math.abs(highs[i] - closes[i - 1]),
          Math.abs(lows[i] - closes[i - 1])
        );
        trueRanges.push(tr);

        if (i < period) {
          result.push(null);
        } else if (i === period) {
          result.push(trueRanges.slice(0, period + 1).reduce((a, b) => a + b, 0) / (period + 1));
        } else {
          result.push((result[i - 1] * (period - 1) + tr) / period);
        }
      }
    }
    return result;
  },

  /**
   * ADX - Average Directional Index (matches Oracle API exactly)
   */
  calculateADX(highs, lows, closes, period = 14) {
    if (closes.length < period * 2) return null;

    const atr = this._calculateATR(highs, lows, closes, period);
    const plusDM = [];
    const minusDM = [];

    for (let i = 0; i < closes.length; i++) {
      if (i === 0) {
        plusDM.push(0);
        minusDM.push(0);
      } else {
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
      }
    }

    // Smooth DM
    const smoothPlusDM = this._calculateEMAArray(plusDM, period);
    const smoothMinusDM = this._calculateEMAArray(minusDM, period);

    // Calculate DX values
    const dx = [];
    for (let i = 0; i < closes.length; i++) {
      if (atr[i] === null || smoothPlusDM[i] === null) {
        dx.push(null);
      } else {
        const pdi = atr[i] > 0 ? (smoothPlusDM[i] / atr[i]) * 100 : 0;
        const mdi = atr[i] > 0 ? (smoothMinusDM[i] / atr[i]) * 100 : 0;
        const diSum = pdi + mdi;
        dx.push(diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
      }
    }

    // ADX is smoothed DX
    const validDx = dx.filter(v => v !== null);
    if (validDx.length < period) return null;

    const adxArray = this._calculateEMAArray(validDx, period);
    return adxArray[adxArray.length - 1];
  }
};

