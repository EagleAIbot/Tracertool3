/**
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * SimulationDetector - Detects if server is running in simulation mode
 */
import { logger } from './state.js';

export const SimulationDetector = {
    /**
     * Check if the server is running in simulation mode by testing for simulation endpoints
     * @returns {Promise<boolean>} True if simulation mode is detected
     */
    async isSimulationMode() {
        // Prefer explicit mode API if available
        try {
            const resp = await fetch('/api/mode', { cache: 'no-store' });
            if (resp.ok) {
                const json = await resp.json();
                if (typeof json?.simulation === 'boolean') return json.simulation;
            }
        } catch (_) { /* ignore and fallback */ }

        // Fallback: feature-probe the scenarios endpoint (legacy behavior)
        try {
            const response = await fetch('/api/simulation/scenarios', { cache: 'no-store' });
            return response.ok;
        } catch (_) {
            return false;
        }
    },

    /**
     * Initialize simulation UI components if simulation mode is detected
     */
    async initializeSimulationUI() {
        const isSimulation = await this.isSimulationMode();

        if (isSimulation) {
            // Show the simulation section
            const simulationSection = document.getElementById('simulationSection');
            if (simulationSection) {
                simulationSection.style.display = 'block';
            }

            // Hide the Strategy Instance selector in simulation mode
            const strategyInstanceGroup = document.querySelector('label[for="strategySelector"]')?.parentElement;
            if (strategyInstanceGroup) {
                strategyInstanceGroup.style.display = 'none';
                logger.trace('Hidden Strategy Instance selector in simulation mode', { ctx: ['Simulation', 'UI'] });
            }

            // Clear any default strategy selection to avoid showing unrelated strategy lines
            const strategySelector = document.getElementById('strategySelector');
            if (strategySelector) {
                strategySelector.value = '';
                // Trigger change event to clear any existing strategy lines
                const changeEvent = new Event('change');
                strategySelector.dispatchEvent(changeEvent);
                logger.trace('Cleared default strategy selection in simulation mode', { ctx: ['Simulation', 'UI'] });
            }

            // Dynamically import and initialize SimulationManager
            try {
                const { default: SimulationManager } = await import('./SimulationManager.js');
                window.simulationManager = new SimulationManager();
                logger.debug('Simulation mode detected - SimulationManager initialized', { ctx: ['Simulation', 'Init'] });
            } catch (error) {
                logger.error('Failed to initialize SimulationManager', { ctx: ['Simulation', 'Init'], error: error.message });
            }
        } else {
            logger.trace('Non-simulation mode - simulation UI hidden', { ctx: ['Simulation', 'UI'] });
        }

        return isSimulation;
    }
};
