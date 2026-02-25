/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */
import { ChartManager } from './ChartManager.js';
import { UIManager } from './UIManager.js';
import { IndicatorManager } from './IndicatorManager.js';
import { initializeTracing, startActiveSpan } from './tracing.js';
import { logger, SERVICE_NAME, ENVIRONMENT } from './state.js';
import { AIChartAnalysis } from './AIChartAnalysis.js';

// Expose managers globally for inline scripts (e.g., backtest trades, armed strategy)
window.ChartManager = ChartManager;
window.IndicatorManager = IndicatorManager;
window.AIChartAnalysis = AIChartAnalysis;
console.log('✅ window.ChartManager set:', !!window.ChartManager);
console.log('✅ window.AIChartAnalysis set:', !!window.AIChartAnalysis);

// --- Initialization ---
/**
 * Entry point: Initializes the chart, sets up UI event listeners, and performs the initial data load
 * once the DOM is fully loaded.
 */
window.addEventListener('DOMContentLoaded', async () => {
  // Initialize browser tracing; export to same-origin proxy
  await initializeTracing({
    serviceName: SERVICE_NAME,
    environment: ENVIRONMENT,
    otlpTracesUrl: './v1/traces',
  });

  await startActiveSpan('ui.init', async () => {
    // Correlated logs: now inside an active span
    const getCtx = (typeof window !== 'undefined' && typeof window.__otel_get_active_span_context === 'function')
      ? window.__otel_get_active_span_context
      : null;
    const sc = getCtx ? getCtx() : null;
    logger.info('Correlation test: span context', {
      ctx: ['TraceCorrelation', 'Init'],
      trace_id: sc && sc.traceId ? sc.traceId : null,
      span_id: sc && sc.spanId ? sc.spanId : null,
    });

    logger.info('UI mounted', { ctx: ['UI_Server_flow', 'App'] });

    logger.trace('DOM Content Loaded', { ctx: ['UI', 'Init'] });
    ChartManager.initialize();

    // Initialize AI Chart Analysis (Full TA Replacement)
    // This creates the prediction line, S/R level lines, and pattern display
    AIChartAnalysis.initialize();
    logger.info('AI Chart Analysis initialized', { ctx: ['AIChart', 'Init'] });

    UIManager.init(); // Initialize UIManager and set global reference
    UIManager.applyDefaultSettings(); // Apply default settings from config
    UIManager.setupEventListeners();
    UIManager.reloadData(); // Initial data load

    // Check for simulation mode and conditionally load simulation UI
    const { SimulationDetector } = await import('./SimulationDetector.js');
    await SimulationDetector.initializeSimulationUI();

    // Note: Periodic staleness check removed - server pushes heartbeat messages via WebSocket
    // that already indicate when strategy instances become stale or die
  });
});
