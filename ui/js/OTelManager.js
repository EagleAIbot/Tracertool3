/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */

/**
 * Centralized OpenTelemetry Manager
 *
 * This class manages all OpenTelemetry initialization and state management
 * for both tracing and logging. It eliminates complex interdependencies
 * between modules by providing a single source of truth for OTel configuration.
 *
 * Features:
 * - Automatic caller information capture for all spans (filepath, lineno, function)
 * - Unified resource management
 * - Trace context propagation
 * - Structured logging with trace correlation
 */

// Direct CDN imports for OpenTelemetry
import { trace, propagation, ROOT_CONTEXT, context, SpanStatusCode } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/api@1.9.0/+esm';
import { WebTracerProvider } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/sdk-trace-web@1.25.1/+esm';
import { BatchSpanProcessor } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/sdk-trace-base@1.25.1/+esm';
import { OTLPTraceExporter } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/exporter-trace-otlp-http@0.41.0/+esm';
import { OTLPLogExporter } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/exporter-logs-otlp-http@0.52.1/+esm';
import { LoggerProvider, BatchLogRecordProcessor } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/sdk-logs@0.52.1/+esm';
import { Resource } from 'https://cdn.jsdelivr.net/npm/@opentelemetry/resources@1.25.1/+esm';
// Define semantic convention constants directly to avoid CDN export issues
const ATTR_SERVICE_NAME = 'service.name';
const ATTR_SERVICE_VERSION = 'service.version';

import { config } from './config.js';

/**
 * Singleton OpenTelemetry Manager class
 */
class OTelManager {
  constructor() {
    this.initialized = false;
    this.tracerProvider = null;
    this.loggerProvider = null;
    this.tracer = null;
    this.logger = null;
    this.resource = null;
    this.sessionId = null;

    // Initialize session ID immediately
    this.sessionId = this.generateSessionId();
  }

  /**
   * Generate a unique session ID for this browser session
   */
  generateSessionId() {
    return `web-session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create shared resource attributes
   */
  createResource() {
    if (this.resource) {
      return this.resource;
    }

    const resourceAttributes = {
      [ATTR_SERVICE_NAME]: config.otel.serviceName,
      [ATTR_SERVICE_VERSION]: '1.0.0',
      'service.environment': config.otel.environment,
      'session.id': this.sessionId,
      'deployment.environment': config.otel.environment,
      'browser.user_agent': navigator.userAgent,
      'browser.language': navigator.language,
      'page.url': window.location.href,
      'page.hostname': window.location.hostname,
    };

    this.resource = new Resource(resourceAttributes);
    return this.resource;
  }

  /**
   * Initialize tracing provider
   */
  initializeTracing() {
    if (this.tracerProvider) {
      return this.tracerProvider;
    }

    try {
      // Create tracer provider with shared resource
      this.tracerProvider = new WebTracerProvider({
        resource: this.createResource(),
      });

      // Create and configure trace exporter
      const traceExporter = new OTLPTraceExporter({
        url: config.otel.otlpTracesUrl,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Add batch span processor
      const spanProcessor = new BatchSpanProcessor(traceExporter, {
        maxExportBatchSize: config.otel.batchSize,
        scheduledDelayMillis: config.otel.flushIntervalMs,
      });

      this.tracerProvider.addSpanProcessor(spanProcessor);

      // Register the tracer provider (uses default propagators)
      this.tracerProvider.register();

      // Get tracer instance
      this.tracer = this.tracerProvider.getTracer(config.otel.serviceName);

      return this.tracerProvider;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Initialize logging provider
   */
  initializeLogging() {
    if (this.loggerProvider) {
      return this.loggerProvider;
    }

    try {
      // Create logger provider with shared resource
      this.loggerProvider = new LoggerProvider({
        resource: this.createResource(),
      });

      // Create and configure log exporter
      const logExporter = new OTLPLogExporter({
        url: config.otel.otlpLogsUrl,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Add batch log processor
      const logProcessor = new BatchLogRecordProcessor(logExporter, {
        maxExportBatchSize: config.otel.batchSize,
        scheduledDelayMillis: config.otel.flushIntervalMs,
      });

      this.loggerProvider.addLogRecordProcessor(logProcessor);

      // Get logger instance
      this.logger = this.loggerProvider.getLogger(config.otel.serviceName);

      return this.loggerProvider;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Initialize both tracing and logging
   */
  async initialize() {
    if (this.initialized) {
      return this;
    }

    try {

      // Initialize tracing and logging
      this.initializeTracing();
      this.initializeLogging();

      // Set up global span context provider
      this.setupGlobalSpanContextProvider();

      this.initialized = true;

      return this;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Set up global span context provider for LogWrap integration
   */
  setupGlobalSpanContextProvider() {
    window.__otel_get_active_span_context = () => {
      try {
        if (this.tracer) {
          const active = trace.getActiveSpan();
          if (active) {
            const sc = active.spanContext();
            if (sc && sc.traceId && sc.spanId) {
              return {
                traceId: sc.traceId,
                spanId: sc.spanId,
                traceFlags: sc.traceFlags
              };
            }
          }
        }
      } catch (error) {
        // Silent error handling
      }
      return null;
    };
  }

  /**
   * Get the tracer instance
   */
  getTracer() {
    if (!this.initialized) {
      throw new Error('OTelManager not initialized. Call initialize() first.');
    }
    return this.tracer;
  }

  /**
   * Get the logger instance
   */
  getLogger() {
    if (!this.initialized) {
      throw new Error('OTelManager not initialized. Call initialize() first.');
    }
    return this.logger;
  }

  /**
   * Get the resource attributes
   */
  getResource() {
    return this.createResource();
  }

  /**
   * Get the session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Get current trace correlation data for log records
   * Returns null if no active span, otherwise returns trace correlation object
   * @private
   */
  _getCurrentTraceCorrelation() {
    try {
      if (this.tracer) {
        const active = trace.getActiveSpan();
        if (active) {
          const sc = active.spanContext();
          if (sc && sc.traceId && sc.spanId) {
            return {
              traceId: sc.traceId,
              spanId: sc.spanId,
              traceFlags: sc.traceFlags
            };
          }
        }
      }
    } catch (error) {
      // Silent error handling
    }

    return null;
  }

  /**
   * Check if OpenTelemetry is enabled in config
   */
  isEnabled() {
    return config.otel.enableOtel;
  }

  /**
   * Extract caller information from the call stack
   * Returns an object with filepath, lineno, and function name
   * @private
   */
  _getCallerInfo() {
    try {
      // Create a new Error to get the stack trace
      const stack = new Error().stack;
      if (!stack) return null;

      // Split stack into lines
      const lines = stack.split('\n');

      // Skip the first few lines (Error, this function, and the tracing wrapper)
      // Look for the first line that's not from OTelManager, tracing, or TracingDecorator
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i];

        // Skip internal tracing files
        if (line.includes('OTelManager.js') ||
            line.includes('tracing.js') ||
            line.includes('TracingDecorator.js')) {
          continue;
        }

        // Parse the stack line to extract file, line number, and function
        // Chrome/Edge format: "    at functionName (file:line:col)"
        // Firefox format: "functionName@file:line:col"
        const chromeMatch = line.match(/at\s+(?:async\s+)?(?:(\S+)\s+)?\((.+):(\d+):(\d+)\)/);
        const firefoxMatch = line.match(/^([^@]*)@(.+):(\d+):(\d+)$/);

        const match = chromeMatch || firefoxMatch;
        if (match) {
          const functionName = (chromeMatch ? match[1] : match[1]) || '<anonymous>';
          const filepath = chromeMatch ? match[2] : match[2];
          const lineno = chromeMatch ? match[3] : match[3];

          return {
            'code.caller.filepath': filepath,
            'code.caller.lineno': lineno,
            'code.caller.function': functionName
          };
        }
      }

      return null;
    } catch (error) {
      // Silent error handling
      return null;
    }
  }

  /**
   * Start a new span with the given name and options
   * Automatically adds caller information (filepath, lineno, function) to the span
   */
  startSpan(name, options = {}) {
    if (!this.initialized || !this.isEnabled()) {
      return null;
    }

    try {
      const span = this.tracer.startSpan(name, options);

      // Add caller information to span
      if (span) {
        const callerInfo = this._getCallerInfo();
        if (callerInfo) {
          for (const [key, value] of Object.entries(callerInfo)) {
            span.setAttribute(key, value);
          }
        }
      }

      return span;
    } catch (error) {
      return null;
    }
  }

  /**
   * Start an active span with the given name and function
   * Automatically adds caller information (filepath, lineno, function) to the span
   */
  async startActiveSpan(name, fn, options = {}) {
    if (!this.initialized || !this.isEnabled()) {
      return await fn();
    }

    try {
      // Capture caller info before entering async context
      const callerInfo = this._getCallerInfo();

      return await this.tracer.startActiveSpan(name, options, async (span) => {
        try {
          // Add caller information to span
          if (callerInfo) {
            for (const [key, value] of Object.entries(callerInfo)) {
              span.setAttribute(key, value);
            }
          }

          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message
          });
          throw error;
        } finally {
          span.end();
        }
      });
    } catch (error) {
      return await fn();
    }
  }

  /**
   * Extract parent context from trace context headers
   */
  extractParentFromTraceContext(traceContext) {
    if (!traceContext || !this.initialized) {
      return ROOT_CONTEXT;
    }

    try {
      const textMapGetter = {
        keys: (carrier) => Object.keys(carrier),
        get: (carrier, key) => carrier[key]
      };

      return propagation.extract(ROOT_CONTEXT, traceContext, textMapGetter);
    } catch (error) {
      return ROOT_CONTEXT;
    }
  }

  /**
   * Start an active span from a traceparent header
   * Automatically adds caller information (filepath, lineno, function) to the span
   */
  async startActiveSpanFromTraceparent(name, fn, traceContext) {
    if (!this.initialized || !this.isEnabled()) {
      return await fn();
    }

    try {
      // Capture caller info before entering async context
      const callerInfo = this._getCallerInfo();
      const parentContext = this.extractParentFromTraceContext(traceContext);

      return await context.with(parentContext, async () => {
        return await this.tracer.startActiveSpan(name, async (span) => {
          try {
            // Add caller information to span
            if (callerInfo) {
              for (const [key, value] of Object.entries(callerInfo)) {
                span.setAttribute(key, value);
              }
            }

            const result = await fn();
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (error) {
            span.recordException(error);
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error.message
            });
            throw error;
          } finally {
            span.end();
          }
        });
      });
    } catch (error) {
      return await fn();
    }
  }


  // --- HIGH-RES TIME HELPERS ---

  epochNanos() {
    const msFloat = performance.timeOrigin + performance.now();
    const ns_int1 = BigInt(Math.round(msFloat*10))*100000n;
    return ns_int1;
  }

  toHrTimeTuple(nsBigInt) {
    const SEC = 1_000_000_000n;
    const s = nsBigInt / SEC;
    const ns = nsBigInt % SEC;
    return [Number(s), Number(ns)]; // [seconds, nanoseconds]
  }

  /**
   * Emit a log record with optional custom processing
   */
  emitLogRecord(logRecord, processor = null) {
    if (!this.initialized || !this.isEnabled() || !this.logger) return;

    try {
      const processed = processor ? processor(logRecord) : logRecord;

      // Force a valid [sec, ns] no matter what the caller sent
      // const ts = this._normalizeHrTime(processed.timestamp);
      const ts = this.epochNanos();
      const [sec, ns] = this.toHrTimeTuple(ts);

      processed.timestamp = [sec, ns];
      processed.attributes['hr_time_ns'] = ts.toString();
      this.logger.emit(processed);

    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * Create a structured log record compatible with OTel Logs SDK
   * Automatically adds trace correlation from current active span
   */
  createLogRecord({
    level,
    severityNumber,
    message,
    attributes = {}
  }) {
    const record = {
      severityNumber: severityNumber || 9, // INFO level default
      severityText: level || 'INFO',
      body: String(message),
      attributes: this._convertAttributes(attributes)
    };

    // Automatically add trace correlation from current active span
    const traceCorrelation = this._getCurrentTraceCorrelation();
    if (traceCorrelation) {
      record.traceId = traceCorrelation.traceId;
      record.spanId = traceCorrelation.spanId;
      if (typeof traceCorrelation.traceFlags === 'number') {
        record.flags = traceCorrelation.traceFlags;
      }
    }

    return record;
  }

  /**
   * Convert attributes to simple key-value format for SigNoz compatibility
   * @private
   */
  _convertAttributes(attrs) {
    const result = {};

    for (const [key, val] of Object.entries(attrs)) {
      if (val === undefined || val === null) continue;

      if (Array.isArray(val)) {
        result[key] = val.join(',');
      } else if (typeof val === 'object') {
        try {
          result[key] = JSON.stringify(val);
        } catch {
          result[key] = '[object]';
        }
      } else {
        result[key] = String(val);
      }
    }

    return result;
  }

  /**
   * Shutdown OpenTelemetry providers
   */
  async shutdown() {
    try {
      const promises = [];

      if (this.tracerProvider) {
        promises.push(this.tracerProvider.shutdown());
      }

      if (this.loggerProvider) {
        promises.push(this.loggerProvider.shutdown());
      }

      await Promise.all(promises);

      this.initialized = false;

    } catch (error) {
      // Silent error handling
    }
  }
}

// Singleton instance - created lazily
let otelManagerInstance = null;

/**
 * Factory method to get or create the OTelManager singleton
 * Ensures initialization happens before first use
 */
export async function getOTelManager() {
  if (!otelManagerInstance) {
    otelManagerInstance = new OTelManager();
    await otelManagerInstance.initialize();
  }
  return otelManagerInstance;
}

/**
 * Synchronous factory for cases where initialization is already guaranteed
 * Throws error if manager hasn't been initialized yet
 */
export function getOTelManagerSync() {
  if (!otelManagerInstance || !otelManagerInstance.initialized) {
    throw new Error('OTelManager not initialized. Call getOTelManager() first.');
  }
  return otelManagerInstance;
}

// Export class for testing/advanced usage
export { OTelManager };
