/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
// Minimal browser logger with console output + optional OTLP/HTTP export (SigNoz/OTel).
// No deps. Works in any modern bundler or <script type="module">.
//
// Configuration:
// - Always uses centralized config from config.js for service name, environment, and URLs
// - Additional resource attributes (like session ID) are shared from tracing provider
// - Constructor parameters can override config defaults if needed

import { config } from '../config.js';
import { getOTelManagerSync } from '../OTelManager.js';

const SEVERITY = { TRACE: 1, DEBUG: 5, INFO: 9, SUCCESS: 9, WARNING: 13, ERROR: 17, CRITICAL: 21 };


class BrowserLogger {
  constructor({
    serviceName = config.otel.serviceName,
    environment = config.otel.environment,
    enableOtel = config.otel.enableOtel,
  } = {}) {
    this.serviceName = serviceName;
    this.environment = environment;
    this.enableOtel = enableOtel;
    this.ctxExtra = {};       // persistent extras via contextualize()
    // Remove custom batching - OTelManager handles this now
  }

  contextualize(extra = {}) {
    this.ctxExtra = { ...this.ctxExtra, ...extra };
    return this;
  }

  _callsite(skip = 3) {
    const e = new Error();
    const stack = e.stack ? e.stack.split("\n") : [];
    const line = stack[skip] || "";

    // Try to extract function name first
    let functionName = null;
    const funcMatch = line.match(/^\s*at\s+([^(]+?)\s+\(/);
    if (funcMatch) {
      functionName = funcMatch[1].trim();
      // Clean up common prefixes like "Object."
      if (functionName.startsWith('Object.')) {
        functionName = functionName.substring(7);
      }
    }

    // Use the original working regex - don't change what works
    const m = line.match(/^\s*at\s+(.*?):(\d+):(\d+)\)?$/);
    if (!m) return {};

    const filepath = m[1].trim();
    const lineno = Number(m[2]);
    const colno = Number(m[3]);
    let filename = filepath;
    try { filename = filepath.split(/[\\/]/).pop(); } catch { }

    return {
      filepath,
      filename,
      line: lineno,
      col: colno,
      function: functionName || "anonymous"
    };
  }


  _emit(level, msg, { ctx = null, ...fields } = {}) {
    // Normalize ctx → ctx + ctxs
    const { ctx: _, message: __, ...rest } = fields;  // Also exclude 'message' from fields
    if (ctx != null) {
      if (Array.isArray(ctx)) {
        const dedup = [...new Set(ctx.map(String))];
        rest.ctxs = dedup;
        if (dedup.length) rest.ctx = dedup[0];
      } else {
        rest.ctx = String(ctx);
        rest.ctxs = [String(ctx)];
      }
    }

    // Serialize object fields immediately to avoid capturing references
    // that may be modified later (async logging issue)
    const serializedRest = {};
    for (const [key, value] of Object.entries(rest)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // For objects (not arrays), serialize to prevent reference capture
        try {
          serializedRest[key] = JSON.parse(JSON.stringify(value));
        } catch (e) {
          serializedRest[key] = String(value);
        }
      } else {
        serializedRest[key] = value;
      }
    }

    const now = new Date();
    const cs = this._callsite(4);

    // Build message with optional structured fields
    let messageText;
    if (typeof msg === 'object' && msg !== null) {
      // Handle DOM events and complex objects with circular references
      try {
        // For MessageEvent and similar DOM objects, extract useful properties
        if (msg.constructor && msg.constructor.name === 'MessageEvent') {
          messageText = JSON.stringify({
            type: msg.type,
            data: msg.data,
            origin: msg.origin,
            lastEventId: msg.lastEventId,
            isTrusted: msg.isTrusted
          });
        } else {
          // For other objects, try normal JSON.stringify
          messageText = JSON.stringify(msg);
        }
      } catch (e) {
        // Fallback for circular references or non-serializable objects
        messageText = `[Object ${msg.constructor?.name || 'Unknown'}]: ${String(msg)}`;
      }
    } else {
      messageText = String(msg);
    }

    // Append structured fields to message if any (for SigNoz message column visibility)
    if (Object.keys(serializedRest).length > 0) {
      // Filter out ctx/ctxs since they're already in the log record
      const fieldsToShow = { ...serializedRest };
      delete fieldsToShow.ctx;
      delete fieldsToShow.ctxs;

      if (Object.keys(fieldsToShow).length > 0) {
        messageText += ` ${JSON.stringify(fieldsToShow)}`;
      }
    }

    const record = {
      timestamp: now.toISOString(),
      level,
      severityText: level,
      severityNumber: SEVERITY[level] ?? SEVERITY.INFO,
      message: messageText,

      service: this.serviceName,

      // fields SigNoz shows natively
      module: cs.filename || "",   // filename only
      line: cs.line || 0,          // line number
      function: cs.function || "",  // function name

      // optional: keep just filepath for deep linking / search
      "code.filepath": cs.filepath || "",

      ...this.ctxExtra,
      ...serializedRest,
    };


    this._consoleWrite(record);

    if (this.enableOtel) {
      this._emitToOTelManager(record);
    }
  }

  _consoleWrite(r) {
    const prefix = `${r.timestamp} | ${r.level.padEnd(8)} |`;
    const loc = r.module ? ` ${r.module}:${r.line}` : "";
    const func = r.function ? ` ${r.function}` : "";
    const ctx = r.ctx ? ` [${r.ctx}]` : "";

    // Message already includes structured fields (added in _emit)
    const line = `${prefix} ${r.service}${loc}${func}${ctx} - ${r.message}`;

    const fn =
      r.level === "ERROR" || r.level === "CRITICAL" ? console.error :
        r.level === "WARNING" ? console.warn :
          r.level === "TRACE" ? console.debug :
            r.level === "DEBUG" ? console.debug :
              console.log;

    fn(line);
  }


  /**
   * Emit log record to OTelManager with SigNoz-specific processing
   * @private
   */
  _emitToOTelManager(record) {
    try {
      const manager = getOTelManagerSync();

      // Create OTel-compatible log record (trace correlation handled automatically)
      const otelRecord = manager.createLogRecord({
        level: record.level,
        severityNumber: record.severityNumber,
        message: record.message,
        attributes: this._buildSigNozAttributes(record)
      });

      manager.emitLogRecord(otelRecord);
    } catch (error) {
      // Graceful fallback - OTelManager not available
      console.debug('[LogWrap] OTelManager not available, skipping telemetry export');
    }
  }

  /**
   * Build SigNoz-specific attributes from LogWrap record
   * @private
   */
  _buildSigNozAttributes(record) {
    const {
      timestamp, level, severityText, severityNumber, message, service,
      ...rest
    } = record;

    return {
      // SigNoz table columns
      module: record.module || "",
      line: record.line || 0,
      function: record.function || "",

      // Code location for deep linking
      "code.filepath": record["code.filepath"] || "",

      // Context system for filtering
      ctx: record.ctx,
      ctxs: record.ctxs,
      ctxs_csv: Array.isArray(record.ctxs) ? record.ctxs.join(",") : record.ctx || "",

      // Service identification
      service: this.serviceName,

      // All other custom fields
      ...rest
    };
  }




  stop() {
    // No-op: OTelManager handles batching and flushing
    return Promise.resolve();
  }

  /**
   * Get runtime session ID from OTelManager
   * @private
   */
  _getSessionId() {
    try {
      const manager = getOTelManagerSync();
      return manager.getSessionId();
    } catch {
      return null;
    }
  }

  // Helper method to serialize objects properly
  _serializeArg(arg) {
    if (typeof arg === 'object' && arg !== null) {
      // Handle DOM events and complex objects with circular references
      try {
        // For MessageEvent and similar DOM objects, extract useful properties
        if (arg.constructor && arg.constructor.name === 'MessageEvent') {
          return JSON.stringify({
            type: arg.type,
            data: arg.data,
            origin: arg.origin,
            lastEventId: arg.lastEventId,
            isTrusted: arg.isTrusted
          });
        }
        // For other objects, try normal JSON.stringify
        return JSON.stringify(arg);
      } catch (e) {
        // Fallback for circular references or non-serializable objects
        return `[Object ${arg.constructor?.name || 'Unknown'}]: ${String(arg)}`;
      }
    }
    return String(arg);
  }

  // Public API - Updated to handle multiple parameters properly
  debug(msg, fields = {}) {
    // If fields is not an object, treat it as old-style ...args for backwards compatibility
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("DEBUG", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("DEBUG", msg, fields);
    }
  }
  info(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("INFO", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("INFO", msg, fields);
    }
  }
  warning(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("WARNING", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("WARNING", msg, fields);
    }
  }
  error(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("ERROR", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("ERROR", msg, fields);
    }
  }
  success(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("SUCCESS", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("SUCCESS", msg, fields);
    }
  }
  trace(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("TRACE", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("TRACE", msg, fields);
    }
  }
  critical(msg, fields = {}) {
    if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
      this._emit("CRITICAL", `${msg} ${this._serializeArg(fields)}`, {});
    } else {
      this._emit("CRITICAL", msg, fields);
    }
  }

  exception(msg, err, opts) {
    const e = err instanceof Error ? err : new Error(String(err));

    // Clean the stack trace to show actual error location, not wrapper functions
    let cleanStack = e.stack;
    if (cleanStack) {
      const lines = cleanStack.split('\n');
      // Remove the first line (error message) and any LogWrap/wrapper lines
      const filteredLines = lines.filter((line, index) => {
        if (index === 0) return true; // Keep error message line
        return !line.includes('LogWrap.js') &&
               !line.includes('_emit') &&
               !line.includes('exception');
      });
      cleanStack = filteredLines.join('\n');
    }

    this._emit("ERROR", `${msg}: ${e.message}`, {
      ...opts,
      exception_type: e.name,
      exception_message: e.message,
      exception_stack: cleanStack,
    });
  }
}

export { BrowserLogger };

export function configureStructuredLogger(opts) {
  return new BrowserLogger(opts);
}
