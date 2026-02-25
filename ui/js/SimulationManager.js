/**
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * SimulationManager - Handles simulation controls and real-time updates
 */

import { logger } from './state.js';
import { ChartManager } from './ChartManager.js';
import { CandleDataManager } from './CandleDataManager.js';
import { UIManager } from './UIManager.js';

export default class SimulationManager {
    constructor() {
        this.currentSimulationId = null;
        this.scenarios = [];
        this.isSimulationRunning = false;
        this.eventCount = 0;

        this.initializeElements();
        this.loadAvailableScenarios();
        this.setupEventListeners();
    }

    initializeElements() {
        this.scenarioSelector = document.getElementById('scenarioSelector');
        this.startBtn = document.getElementById('startSimulationBtn');
        this.stopBtn = document.getElementById('stopSimulationBtn');
        this.statusDiv = document.getElementById('simulationStatus');
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startSimulation());
        this.stopBtn.addEventListener('click', () => this.stopSimulation());

        // Add scenario selection event listener for auto instance selection
        this.scenarioSelector.addEventListener('change', (e) => this.onScenarioChange(e));

        // Listen for WebSocket simulation events
        if (window.webSocketManager) {
            logger.trace('Setting up WebSocket simulation event handlers', { ctx: ['Simulation', 'WebSocket'] });
            window.webSocketManager.addMessageHandler('simulation_event', (data) => {
                this.handleSimulationEvent(data);
            });

            window.webSocketManager.addMessageHandler('simulation_status', (data) => {
                this.updateSimulationStatus(data);
            });

            // Also listen for general strategy events that might be simulation-related
            window.webSocketManager.addMessageHandler('strategy_event', (data) => {
                if (this.isSimulationRunning) {
                    this.handleStrategyEvent(data);
                }
            });
        }
    }

    async loadAvailableScenarios() {
        try {
            const response = await fetch('/api/simulation/scenarios');

            if (response.ok) {
                this.scenarios = await response.json();
                this.populateScenarioSelector();
            } else {
                logger.error('Failed to load scenarios', { ctx: ['Simulation', 'Scenarios'], status: response.status, statusText: response.statusText });
            }
        } catch (error) {
            logger.error('Error loading scenarios', { ctx: ['Simulation', 'Scenarios'], error: error.message });
        }
    }

    populateScenarioSelector() {
        // Clear existing options except the first one
        while (this.scenarioSelector.children.length > 1) {
            this.scenarioSelector.removeChild(this.scenarioSelector.lastChild);
        }

        // Add scenario options
        this.scenarios.forEach(scenario => {
            const option = document.createElement('option');
            option.value = scenario.file;
            option.textContent = `${scenario.name} (${scenario.duration}s)`;
            this.scenarioSelector.appendChild(option);
        });
    }

    async startSimulation() {
        const selectedScenario = this.scenarioSelector.value;

        if (!selectedScenario) {
            return;
        }

        try {
            // Clear chart and reset state before starting simulation
            await this.resetChartForSimulation();

            this.currentSimulationId = `sim_${Date.now()}`;

            const requestBody = {
                scenario_file: selectedScenario,
                simulation_id: this.currentSimulationId
            };

            const response = await fetch('/api/simulation/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (response.ok) {
                const result = await response.json();
                logger.debug('Simulation started', { ctx: ['Simulation', 'Start'], result });
                this.isSimulationRunning = true;
                this.updateUIState();
                this.updateStatus('Running');

                // Switch to the simulation's strategy instance for event tracking
                if (result.strategy_instance_name) {
                    // Set the state immediately before any data reloading
                    const { state } = await import('./state.js');
                    state.strategyInstanceName = result.strategy_instance_name;

                    const strategySelector = document.getElementById('strategy-instance-selector');
                    if (strategySelector) {
                        // Set the selector value and trigger change event
                        strategySelector.value = result.strategy_instance_name;
                        const changeEvent = new Event('change');
                        strategySelector.dispatchEvent(changeEvent);
                    }
                }

                // Start polling for simulation events as fallback
                this.startEventPolling();
            } else {
                const error = await response.text();
                logger.error('Failed to start simulation', { ctx: ['Simulation', 'Start'], error });
            }
        } catch (error) {
            logger.error('Error starting simulation', { ctx: ['Simulation', 'Start'], error: error.message });
        }
    }

    async stopSimulation() {
        if (!this.currentSimulationId) {
            return;
        }

        try {
            const response = await fetch(`/api/simulation/stop/${this.currentSimulationId}`, {
                method: 'POST'
            });

            if (response.ok) {
                this.isSimulationRunning = false;
                this.updateUIState();
                this.stopEventPolling();
                this.updateStatus('Stopped');
                this.currentSimulationId = null;
            } else {
                const error = await response.text();
                logger.error('Error stopping simulation', { ctx: ['Simulation', 'Stop'], error });

                // If simulation not found, it likely completed already - reset UI state
                if (response.status === 404 || error.includes('not found')) {
                    this.isSimulationRunning = false;
                    this.updateUIState();
                    this.stopEventPolling();
                    this.currentSimulationId = null;
                }
            }
        } catch (error) {
            logger.error('Error stopping simulation', { ctx: ['Simulation', 'Stop'], error: error.message });
        }
    }

    updateUIState() {
        this.startBtn.disabled = this.isSimulationRunning;
        this.stopBtn.disabled = !this.isSimulationRunning;
        this.scenarioSelector.disabled = this.isSimulationRunning;
    }

    updateStatus(status) {
        this.statusDiv.textContent = `Status: ${status}`;
        this.statusDiv.style.color = this.getStatusColor(status);
    }

    getStatusColor(status) {
        switch (status.toLowerCase()) {
            case 'running': return '#28a745';
            case 'stopped': return '#dc3545';
            case 'completed': return '#007bff';
            case 'error': return '#dc3545';
            default: return '#999';
        }
    }

    handleSimulationEvent(data) {
        const { event_type, message, timestamp, simulation_id } = data;

        // Only show events for current simulation
        if (simulation_id && simulation_id !== this.currentSimulationId) {
            return;
        }

        let icon = '📊';
        let type = 'info';

        switch (event_type) {
            case 'trade_entry':
                icon = '📈';
                type = 'success';
                break;
            case 'trade_exit':
                icon = '📉';
                type = 'info';
                break;
            case 'stop_loss':
                icon = '🛑';
                type = 'warning';
                break;
            case 'prediction':
                icon = '🔮';
                type = 'info';
                break;
            case 'error':
                icon = '❌';
                type = 'error';
                break;
            case 'completed':
                icon = '✅';
                type = 'success';
                this.isSimulationRunning = false;
                this.updateUIState();
                this.updateStatus('Completed');
                break;
        }

    }

    updateSimulationStatus(data) {
        const { status, simulation_id } = data;

        if (simulation_id === this.currentSimulationId) {
            this.updateStatus(status);

            if (status === 'completed' || status === 'error') {
                this.isSimulationRunning = false;
                this.updateUIState();
            }
        }
    }



    async onScenarioChange(event) {
        const selectedScenario = event.target.value;
        if (!selectedScenario) {
            return;
        }

        try {
            // Find the scenario data to get the instance name
            const scenario = this.scenarios.find(s => s.file === selectedScenario);
            if (scenario) {
                // Use the scenario's instance_name from config, or fall back to scenario name
                const instanceName = scenario.instance_name || scenario.name;
                this.setStrategyInstance(instanceName);
            }
        } catch (error) {
            logger.error('Failed to auto-select strategy instance', { ctx: ['Simulation', 'Strategy'], error: error.message });
        }
    }

    setStrategyInstance(instanceName) {
        const strategySelector = document.getElementById('strategySelector');
        if (strategySelector) {
            // Set the strategy instance value
            strategySelector.value = instanceName;

            // Trigger change event to update the UI state
            const changeEvent = new Event('change');
            strategySelector.dispatchEvent(changeEvent);
        }
    }

    startEventPolling() {
        // Real simulation events will come through WebSocket handlers
        // No need for fake polling events
    }

    handleStrategyEvent(data) {
        // Strategy events are now handled by the main chart system
        // No need for simulation-specific event logging
    }

    async resetChartForSimulation() {
        try {
            // Clear strategy events from chart
            ChartManager.clearAllStrategyData();

            // Reset live candle state
            CandleDataManager.resetState();

            // Clear candle data by reloading chart data
            await UIManager.reloadData();
        } catch (error) {
            logger.error('Error resetting chart for simulation', { ctx: ['Simulation', 'Chart'], error: error.message });
        }
    }

    stopEventPolling() {
        if (this.eventPollingInterval) {
            clearInterval(this.eventPollingInterval);
            this.eventPollingInterval = null;
        }
    }
}

// Initialize simulation manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.simulationManager = new SimulationManager();
    } catch (error) {
        logger.error('Failed to initialize SimulationManager', { ctx: ['Simulation', 'Init'], error: error.message });
    }
});
