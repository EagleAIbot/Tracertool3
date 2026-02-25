/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { logger } from './state.js';
import { state } from './state.js';


/**
 * General utility functions for the application.
 */

/**
 * Helper function to parse RFC3339 timestamp strings to Unix timestamp seconds
 * @param {string|number|Object} t - RFC3339 formatted timestamp string, number (seconds or milliseconds), or BusinessDay object
 * @returns {number} Unix timestamp in seconds, or null if parsing fails
 */
export function parseTimeToSecondsUTC(t) {
  try {
    if (t === null || t === undefined) return null;

    // Handle numbers (seconds or milliseconds)
    if (typeof t === 'number' && Number.isFinite(t)) {
      return t > 1e12 ? Math.round(t / 1000) : Math.round(t);
    }

    // Handle Lightweight Charts BusinessDay objects
    if (typeof t === 'object' && 'year' in t && 'month' in t && 'day' in t) {
      return Math.floor(Date.UTC(t.year, t.month - 1, t.day) / 1000);
    }

    // Handle strings
    if (typeof t === 'string') {
      const d = new Date(t);
      if (Number.isNaN(+d)) {
        throw new Error('Invalid date string');
      }
      return Math.floor(d.getTime() / 1000);
    }

    // If none of the above, the type is unsupported
    throw new Error(`Unsupported type for timestamp conversion: ${typeof t}`);

  } catch (e) {
    logger.error("Error parsing timestamp", { ctx: ['Utils', 'Parser'], timestamp: t, error: e.message });
    return null;
  }
}

/**
 * Converts a Unix timestamp in seconds to an RFC3339 string.
 * @param {number} sec - Unix timestamp in seconds.
 * @returns {string} RFC3339 formatted string or 'Invalid time'.
 */
export function toRFC3339FromSeconds(sec) {
  return Number.isFinite(sec)
    ? new Date(sec * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    : 'Invalid time';
}

/**
 * Shift every point’s time so that local timestamps plot correctly
 * on a UTC‐based Lightweight-Charts axis.
 *
 * @param {Array<Object>} data
 *   Array of objects with at least a numeric `time` field (UNIX seconds).
 *   Other properties (e.g. open/high/low/close/value) are preserved.
 * @returns {Array<Object>}
 *   A new array of points with `time` adjusted by the local UTC offset.
 */
export function shiftDataToLocalTime(data) {

  if (state.timeDisplayMode === 'UTC') {
    return data;
  }

  const shifted = [];
  let lastDayKey = null;
  let lastOffsetSec = 0;

  for (const p of data) {

    const dt = new Date(p.time * 1000);

    // Day‐key in user's locale, e.g. "2025-6-28"
    const dayKey = `${dt.getFullYear()}-${dt.getMonth()+1}-${dt.getDate()}`;

    // Only recalc offset when the day changes (handles DST switches)
    if (dayKey !== lastDayKey) {
      if (state.timeDisplayMode === 'NY') {
        lastOffsetSec = getOffsetInSecondsForTimeZone(dt, 'America/New_York');
      }else{
        lastOffsetSec = dt.getTimezoneOffset() * 60;  // minutes → seconds
      }
      lastDayKey = dayKey;
    }

    // Clone the point, replacing just `time`
    shifted.push({
      ...p,
      time: p.time - lastOffsetSec,
    });
  }

  // CRITICAL: Sort the shifted data to ensure ascending time order
  // When data spans DST transitions, different offsets can reverse chronological order
  shifted.sort((a, b) => a.time - b.time);

  // CRITICAL: Remove duplicate timestamps that can occur at DST "fall back" transitions
  // When DST falls back, the same clock hour occurs twice (e.g., 1:00 AM occurs twice)
  // After timezone conversion, multiple UTC candles can map to the same local time
  // Chart library requires strictly ascending times, so we deduplicate, keeping the latest entry
  const deduplicated = [];
  for (let i = 0; i < shifted.length; i++) {
    // Look ahead: if next candle has the same timestamp, skip current one (keep the later occurrence)
    if (i < shifted.length - 1 && shifted[i].time === shifted[i + 1].time) {
      continue; // Skip this duplicate, next one is more recent
    }
    deduplicated.push(shifted[i]);
  }

  return deduplicated;
}

/**
 * Shift a single point’s time so that its local timestamp
 * plots correctly on a UTC‐based Lightweight-Charts axis.
 *
 * @param {Object} p
 *   An object with at least a numeric `time` property (UNIX seconds).
 *   Any other properties (e.g. open/high/low/close/value) will be preserved.
 * @returns {Object}
 *   A new object where `time` is replaced by (original time + local offset).
 */
export function shiftPointToLocalTime(p) {

  if (state.timeDisplayMode === 'UTC') {
    return p;
  }

  const dt = new Date(p.time * 1000);

  // getTimezoneOffset() returns (minutes UTC – minutes local)
  let offsetSeconds = 0;
  if (state.timeDisplayMode === 'NY') {
    offsetSeconds = getOffsetInSecondsForTimeZone(dt, 'America/New_York');
  }else{
    offsetSeconds = dt.getTimezoneOffset() * 60;
  }

  // Return a copy of the point with its time nudged by that offset
  return {
    ...p,
    time: p.time - offsetSeconds,
  };
}


/**
 * Convert a UTC timestamp to a local time by applying the timezone offset.
 *
 * @param {number} ts - UTC timestamp in seconds
 * @returns {number} - Local timestamp in seconds
 */
export function shiftTimeStampToLocal(ts) {

  if (state.timeDisplayMode === 'UTC') {
    return ts;
  }

  const dt = new Date(ts * 1000);

  // getTimezoneOffset() returns (minutes UTC – minutes local)
  let offsetSeconds = 0;
  if (state.timeDisplayMode === 'NY') {
    offsetSeconds = getOffsetInSecondsForTimeZone(dt, 'America/New_York');
  }else{
    offsetSeconds = dt.getTimezoneOffset() * 60;
  }

  // Apply the offset to convert UTC timestamp to local timestamp
  return ts - offsetSeconds;
}

/**
 * Convert a local timestamp back to UTC by removing the timezone offset.
 *
 * @param {number} ts - Local timestamp in seconds
 * @returns {number} - UTC timestamp in seconds
 */
export function unshiftTimeStampToUtc(ts) {

  if (state.timeDisplayMode === 'UTC') {
    return ts;
  }

  const dt = new Date(ts * 1000);

  // getTimezoneOffset() returns (minutes UTC − minutes local)
  let offsetSeconds = 0;
  if (state.timeDisplayMode === 'NY') {
    offsetSeconds = getOffsetInSecondsForTimeZone(dt, 'America/New_York');
  }else{
    offsetSeconds = dt.getTimezoneOffset() * 60;
  }

  // Apply the offset to convert local timestamp to UTC timestamp
  return ts + offsetSeconds;
}


export function floorToBucket(msTimestamp, interval) {
  const msInBucket = interval * 1000;
  return Math.floor(msTimestamp / msInBucket) * msInBucket;
}

export function filterForFirstInBar(data, interval) {

  const seenBuckets = new Set();
  const result = [];

  for (const entry of data) {

    const bucket = floorToBucket(parseTimeToSecondsUTC(entry.predicted_time)*1000, interval);

    if (!seenBuckets.has(bucket)) {

      seenBuckets.add(bucket);

      result.push(entry);

    }

  }

  return result;
}

export function filterForLastInBar(data, interval) {
  const bucketMap = new Map();

  for (const entry of data) {
    const bucket = floorToBucket(parseTimeToSecondsUTC(entry.predicted_time) * 1000, interval);
    // Always overwrite — so the last one in that bucket wins
    bucketMap.set(bucket, entry);
  }

  // Return the values as an array
  return Array.from(bucketMap.values());
}

/**
 * Calculates the timezone offset in seconds for a given date and IANA timezone.
 * This is the difference between the specified timezone and UTC.
 *
 * @param {Date} date - The date for which to calculate the offset.
 * @param {string} timeZone - The IANA timezone name (e.g., 'America/New_York').
 * @returns {number} The timezone offset in seconds.
 */
function getOffsetInSecondsForTimeZone(date, timeZone) {
  // Create a date string in the specified timezone
  const zonedDateStr = date.toLocaleString('en-US', { timeZone });

  // Create a date string in UTC
  const utcDateStr = date.toLocaleString('en-US', { timeZone: 'UTC' });

  // Calculate the difference in milliseconds and convert to seconds
  const diff =  new Date(utcDateStr).getTime() - new Date(zonedDateStr).getTime()

  return diff / 1000;
}
