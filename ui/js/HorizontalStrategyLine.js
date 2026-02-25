/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */

import { positionsLine } from './helpers/positions.js';

class HorizontalStrategyLineRenderer {
	constructor(config) {
		this._price = null;
		this._color = config.defaultColor;
		this._visible = false;
		this._config = config;
		this._extraState = {}; // For line-specific state like isTrailing
	}

	update(priceY, color, visible, extraState = {}) {
		this._price = priceY;
		this._color = color;
		this._visible = visible;
		this._extraState = extraState;
	}

	draw(target) {
		if (!this._visible || this._price === null) return;

		target.useBitmapCoordinateSpace(scope => {
			const yPosition = positionsLine(this._price, scope.verticalPixelRatio, scope.verticalPixelRatio);
			const yCentre = yPosition.position + yPosition.length / 2;
			const ctx = scope.context;

			// Determine label based on config and state
			let label = this._config.label;
			if (this._config.dynamicLabel && this._extraState.isTrailing) {
				label = this._config.trailingLabel || label;
			}

			// Calculate label dimensions
			ctx.font = `${this._config.fontSize * scope.verticalPixelRatio}px Arial`;
			const labelWidth = ctx.measureText(label).width;
			const labelPadding = this._config.labelPadding * scope.horizontalPixelRatio;

			// Calculate line coordinates
			let lineStartX = 0;
			let lineEndX = scope.bitmapSize.width - labelWidth - labelPadding;

			// Handle short lines (like TEST)
			if (this._config.lineLength !== null) {
				const lineLength = this._config.lineLength * scope.horizontalPixelRatio;
				lineStartX = lineEndX - lineLength;
			}

			// Set line opacity if specified
			if (this._config.lineAlpha !== 1.0) {
				ctx.globalAlpha = this._config.lineAlpha;
			}

			// Draw the line
			ctx.beginPath();
			ctx.setLineDash(this._config.dashPattern.map(d => d * scope.verticalPixelRatio));
			ctx.moveTo(lineStartX, yCentre);
			ctx.lineTo(lineEndX, yCentre);
			ctx.strokeStyle = this._color;
			ctx.lineWidth = this._config.lineWidth * scope.verticalPixelRatio;
			ctx.stroke();

			// Reset alpha for label
			if (this._config.lineAlpha !== 1.0) {
				ctx.globalAlpha = 1.0;
			}

			// Draw label
			ctx.fillStyle = this._color;
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			const labelX = scope.bitmapSize.width - this._config.labelOffset * scope.horizontalPixelRatio;
			ctx.fillText(label, labelX, yCentre);
		});
	}
}

class HorizontalStrategyLineView {
	constructor(config) {
		this._renderer = new HorizontalStrategyLineRenderer(config);
	}

	renderer() {
		return this._renderer;
	}

	update(priceY, color, visible, extraState) {
		this._renderer.update(priceY, color, visible, extraState);
	}
}

export class HorizontalStrategyLine {
	constructor(config) {
		// Default configuration
		const defaultConfig = {
			defaultColor: '#FFFFFF',
			label: 'LINE',
			fontSize: 12,
			labelPadding: 10,
			labelOffset: 5,
			lineWidth: 1,
			dashPattern: [], // Solid line
			lineLength: null, // Full width
			lineAlpha: 1.0,
			dynamicLabel: false,
			trailingLabel: null
		};

		this._config = { ...defaultConfig, ...config };
		this._paneViews = [new HorizontalStrategyLineView(this._config)];
		this._chart = null;
		this._series = null;
		this._requestUpdate = null;
		this._price = null;
		this._visible = false;
		this._color = this._config.defaultColor;
		this._extraState = {};
	}

	attached({ chart, series, requestUpdate }) {
		this._chart = chart;
		this._series = series;
		this._requestUpdate = requestUpdate;
	}

	detached() {
		this._chart = null;
		this._series = null;
		this._requestUpdate = null;
	}

	/**
	 * Updates the line with new price and visibility
	 * @param {number|null} price - The price level
	 * @param {boolean} visible - Whether the line should be visible
	 * @param {string} [color] - Optional color override
	 * @param {Object} [extraState] - Additional state (e.g., isTrailing)
	 */
	updateLine(price, visible, color, extraState = {}) {
		this._price = price;
		this._visible = visible;
		this._extraState = extraState;

		if (color) {
			this._color = color;
		} else {
			this._color = this._config.defaultColor;
		}

		if (this._requestUpdate) {
			this._requestUpdate();
		}
		// Note: If not attached yet, the update will happen automatically when attached
	}

	/**
	 * Shows the line at the specified price
	 * @param {number} price - The price level
	 * @param {string} [color] - Optional color override
	 * @param {boolean|Object} [extraStateOrTrailing] - Additional state or trailing flag for backward compatibility
	 */
	show(price, color, extraStateOrTrailing = {}) {
		let extraState = {};

		// Handle backward compatibility for trailing stop loss
		if (typeof extraStateOrTrailing === 'boolean') {
			extraState = { isTrailing: extraStateOrTrailing };
			// Auto-change color to orange if trailing and no color specified
			if (extraStateOrTrailing && !color && this._config.dynamicLabel) {
				color = '#FFA500'; // Orange for trailing
			}
		} else if (typeof extraStateOrTrailing === 'object') {
			extraState = extraStateOrTrailing;
		}

		this.updateLine(price, true, color, extraState);
	}

	/**
	 * Hides the line
	 */
	hide() {
		this.updateLine(null, false);
	}

	/**
	 * Returns whether the line is currently visible
	 * @returns {boolean} True if the line is visible
	 */
	isVisible() {
		return this._visible;
	}

	/**
	 * Returns the current price of the line
	 * @returns {number|null} The current price, or null if not set
	 */
	getPrice() {
		return this._price;
	}

	updateAllViews() {
		if (!this._series || !this._chart) return;

		let priceY = null;
		if (this._price !== null && this._visible) {
			priceY = this._series.priceToCoordinate(this._price);
		}

		this._paneViews.forEach(pw => pw.update(priceY, this._color, this._visible, this._extraState));
	}

	paneViews() {
		return this._paneViews;
	}
}

// Export pre-configured factory functions for each line type
export const createStopLossLine = () => new HorizontalStrategyLine({
	defaultColor: '#FF4444',
	label: 'SL',
	fontSize: 12,
	labelPadding: 10,
	labelOffset: 5,
	lineWidth: 2,
	dashPattern: [6, 3],
	dynamicLabel: true,
	trailingLabel: 'TSL'
});

export const createTargetLine = () => new HorizontalStrategyLine({
	defaultColor: '#00FF00',
	label: 'TP',
	fontSize: 12,
	labelPadding: 10,
	labelOffset: 5,
	lineWidth: 1.5,
	dashPattern: [2, 4]
});

export const createTrailingStopActivationLine = () => new HorizontalStrategyLine({
	defaultColor: '#FFFF00',
	label: 'TSA',
	fontSize: 10,
	labelPadding: 10,
	labelOffset: 5,
	lineWidth: 1,
	dashPattern: [2, 6],
	lineAlpha: 0.4
});

export const createTestPriceLine = () => new HorizontalStrategyLine({
	defaultColor: '#0080FF',
	label: 'TEST',
	fontSize: 10,
	labelPadding: 8,
	labelOffset: 3,
	lineWidth: 1,
	dashPattern: [], // Solid line
	lineLength: 60
});
