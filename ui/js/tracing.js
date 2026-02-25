/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
// tracing.js - Simplified OpenTelemetry Web tracing for the UI
// Now uses centralized OTelManager for initialization and state management
//
// All spans automatically include caller information:
// - code.caller.filepath: Source file where the span was created
// - code.caller.lineno: Line number where the span was created
// - code.caller.function: Function name where the span was created

import { getOTelManager, getOTelManagerSync } from './OTelManager.js';


// Global span context provider is now managed by OTelManager
// This will be set up automatically when OTelManager initializes

/**
 * Initialize browser tracing using centralized OTelManager
 */
export async function initializeTracing() {
  try {
    const manager = await getOTelManager();
    console.debug('[tracing] Initialized successfully via OTelManager');
    return manager.getTracer();
  } catch (err) {
    console.error('[tracing] Failed to initialize:', err);
    return null;
  }
}



/**
 * Extract a parent Context from a flat trace context object.
 * Expects: { traceparent: "00-<32hex>-<16hex>-<2hex>", tracestate?: "..." }
 */
export function extractParentFromFlatTraceCtx(traceCtxObj) {
  try {
    const manager = getOTelManagerSync();
    return manager.extractParentFromTraceContext(traceCtxObj);
  } catch {
    return null;
  }
}

/**
 * Start an active span using an incoming flat trace context JSON as parent.
 */
export async function startActiveSpanFromTraceparent(name, fn, flatTraceCtx, options = {}) {
  try {
    const manager = getOTelManagerSync();
    return await manager.startActiveSpanFromTraceparent(name, fn, flatTraceCtx);
  } catch {
    return await fn();
  }
}

/**
 * Start an active span with optional configuration.
 *
 * Usage:
 * - startActiveSpan(name, fn)
 * - startActiveSpan(name, fn, options)
 */
export async function startActiveSpan(name, fn, options = {}) {
  try {
    const manager = getOTelManagerSync();
    return await manager.startActiveSpan(name, fn, options);
  } catch {
    return await fn();
  }
}
