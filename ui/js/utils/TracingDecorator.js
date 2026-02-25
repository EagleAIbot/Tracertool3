/**
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * TracingDecorator - JavaScript tracing decorator mechanism similar to Python @tracing
 *
 * All decorated methods and traced functions automatically capture caller information:
 * - code.caller.filepath: Source file where the method/function was called
 * - code.caller.lineno: Line number where the call was made
 * - code.caller.function: Calling function name
 */

import { startActiveSpan } from '../tracing.js';
import { logger } from '../state.js';

/**
 * Tracing decorator function that wraps methods with OpenTelemetry spans
 * @param {string} spanName - Name for the span (optional, defaults to className.methodName)
 * @param {Object} options - Additional options for span creation
 * @returns {Function} Decorator function
 */
export function traced(spanName = null, options = {}) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;
    const defaultSpanName = spanName || `${className}.${propertyKey}`;

    descriptor.value = async function(...args) {
      return await startActiveSpan(defaultSpanName, async () => {
        try {
          // Add span attributes if provided
          if (options.attributes) {
            // Note: In a full implementation, you'd set these on the active span
            logger.trace('Span attributes', {
              ctx: ['Tracing', 'Decorator'],
              spanName: defaultSpanName,
              attributes: options.attributes
            });
          }

          // Call the original method
          const result = await originalMethod.apply(this, args);
          return result;
        } catch (error) {
          // Log error and re-throw
          logger.error('Method execution failed', {
            ctx: ['Tracing', 'Decorator'],
            spanName: defaultSpanName,
            error: error.message,
            stack: error.stack
          });
          throw error;
        }
      });
    };

    return descriptor;
  };
}

/**
 * Higher-order function that wraps regular functions with tracing
 * @param {Function} fn - Function to wrap
 * @param {string} spanName - Name for the span
 * @param {Object} options - Additional options
 * @returns {Function} Wrapped function
 */
export function withTracing(fn, spanName, options = {}) {
  return async function(...args) {
    return await startActiveSpan(spanName, async () => {
      try {
        if (options.attributes) {
          logger.trace('Span attributes', {
            ctx: ['Tracing', 'Wrapper'],
            spanName,
            attributes: options.attributes
          });
        }

        const result = await fn.apply(this, args);
        return result;
      } catch (error) {
        logger.error('Function execution failed', {
          ctx: ['Tracing', 'Wrapper'],
          spanName,
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
  };
}

/**
 * Utility to create a traced version of an object's methods
 * @param {Object} obj - Object to instrument
 * @param {Array<string>} methodNames - Method names to trace
 * @param {string} prefix - Prefix for span names
 * @returns {Object} Instrumented object
 */
export function instrumentObject(obj, methodNames, prefix = '') {
  const instrumented = { ...obj };

  // First pass: wrap all methods but don't bind yet
  const wrappedMethods = {};
  methodNames.forEach(methodName => {
    if (typeof obj[methodName] === 'function') {
      const spanName = prefix ? `${prefix}.${methodName}` : methodName;
      const originalMethod = obj[methodName];

      // Create wrapper that will be bound to instrumented object
      wrappedMethods[methodName] = function(...args) {
        // Try calling the original method to detect if it's async
        let result;
        try {
          result = originalMethod.apply(this, args);
        } catch (error) {
          // Synchronous error - log and rethrow
          logger.error('Function execution failed', {
            ctx: ['Tracing', 'Wrapper'],
            spanName,
            error: error.message,
            stack: error.stack
          });
          throw error;
        }

        // If result is a Promise, wrap with async tracing
        if (result instanceof Promise) {
          return startActiveSpan(spanName, async () => {
            try {
              return await result;
            } catch (error) {
              logger.error('Async function execution failed', {
                ctx: ['Tracing', 'Wrapper'],
                spanName,
                error: error.message,
                stack: error.stack
              });
              throw error;
            }
          });
        } else {
          // Synchronous function - return result directly (no async wrapping)
          // Note: This skips tracing for sync functions to maintain sync behavior
          return result;
        }
      };
    }
  });

  // Second pass: assign all wrapped methods to instrumented object
  Object.keys(wrappedMethods).forEach(methodName => {
    instrumented[methodName] = wrappedMethods[methodName];
  });

  return instrumented;
}

/**
 * Class-level decorator that automatically instruments all methods
 * @param {string} prefix - Optional prefix for span names (defaults to class name)
 * @param {Object} options - Configuration options
 * @returns {Function} Class decorator
 */
export function tracedClass(prefix = null, options = {}) {
  return function(target) {
    const className = target.name;
    const spanPrefix = prefix || className.toLowerCase();

    // Get all method names from prototype (excluding constructor)
    const methodNames = Object.getOwnPropertyNames(target.prototype)
      .filter(name => {
        return name !== 'constructor' &&
               typeof target.prototype[name] === 'function' &&
               !name.startsWith('_'); // Skip private methods by convention
      });

    // Instrument each method
    methodNames.forEach(methodName => {
      const originalMethod = target.prototype[methodName];
      const spanName = `${spanPrefix}.${methodName}`;

      target.prototype[methodName] = async function(...args) {
        return await startActiveSpan(spanName, async () => {
          try {
            // Add class-level attributes if provided
            if (options.attributes) {
              logger.trace('Class method span attributes', {
                ctx: ['Tracing', 'Class'],
                spanName,
                className,
                methodName,
                attributes: options.attributes
              });
            }

            // Call the original method
            const result = await originalMethod.apply(this, args);
            return result;
          } catch (error) {
            // Log error and re-throw
            logger.error('Class method execution failed', {
              ctx: ['Tracing', 'Class'],
              spanName,
              className,
              methodName,
              error: error.message,
              stack: error.stack
            });
            throw error;
          }
        });
      };
    });

    // Log instrumentation info
    logger.debug('Class instrumented with tracing', {
      ctx: ['Tracing', 'Class'],
      className,
      methodCount: methodNames.length,
      methods: methodNames,
      spanPrefix
    });

    return target;
  };
}

/**
 * Alternative approach: Function that instruments an existing class
 * @param {Function} ClassConstructor - Class to instrument
 * @param {string} prefix - Optional prefix for span names
 * @param {Object} options - Configuration options
 * @returns {Function} Instrumented class
 */
export function instrumentClass(ClassConstructor, prefix = null, options = {}) {
  return tracedClass(prefix, options)(ClassConstructor);
}

/**
 * Auto-discovery version of instrumentObject that finds all methods automatically
 * @param {Object} obj - Object to instrument
 * @param {string} prefix - Prefix for span names
 * @param {Object} options - Configuration options
 * @param {boolean} options.includePrivate - Include methods starting with _ (default: false)
 * @returns {Object} Instrumented object
 */
export function instrumentObjectAuto(obj, prefix = null, options = {}) {
  const { includePrivate = false } = options;

  // Auto-derive prefix from object if not provided
  const derivedPrefix = prefix || obj._className || obj.constructor?.name || 'UnknownObject';

  // Auto-discover all method names
  const methodNames = Object.getOwnPropertyNames(obj)
    .filter(name => {
      return typeof obj[name] === 'function' &&
             name !== 'constructor' &&   // Skip constructor if present
             (includePrivate || !name.startsWith('_')); // Include/exclude private methods based on option
    });

  logger.debug('Auto-instrumenting object methods', {
    ctx: ['Tracing', 'Object'],
    prefix: derivedPrefix,
    methodCount: methodNames.length,
    methods: methodNames,
    includePrivate
  });

  return instrumentObject(obj, methodNames, derivedPrefix);
}

/**
 * Macro-like function for quick tracing of code blocks
 * @param {string} spanName - Name for the span
 * @param {Function} fn - Function to execute within span
 * @param {Object} options - Additional options
 * @returns {Promise} Result of the function
 */
export async function trace(spanName, fn, options = {}) {
  return await startActiveSpan(spanName, async () => {
    try {
      if (options.attributes) {
        logger.trace('Span attributes', {
          ctx: ['Tracing', 'Block'],
          spanName,
          attributes: options.attributes
        });
      }

      return await fn();
    } catch (error) {
      logger.error('Traced block failed', {
        ctx: ['Tracing', 'Block'],
        spanName,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  });
}
