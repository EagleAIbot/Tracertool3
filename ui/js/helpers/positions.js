/*!
 * © 2025 Cayman Sunsets Holidays Ltd. All rights reserved.
 *
 * This software and its source code are proprietary and confidential.
 * Unauthorized copying, distribution, or modification of this file, in
 * whole or in part, without the express written permission of
 * Cayman Sunsets Holidays Ltd is strictly prohibited.
 */

function centreOffset(lineBitmapWidth) {
	return Math.floor(lineBitmapWidth * 0.5);
}

/**
 * Calculates the bitmap position for an item with a desired length (height or width), and centred according to
 * an position coordinate defined in media sizing.
 * @param {number} positionMedia - position coordinate for the bar (in media coordinates)
 * @param {number} pixelRatio - pixel ratio. Either horizontal for x positions, or vertical for y positions
 * @param {number} [desiredWidthMedia=1] - desired width (in media coordinates)
 * @param {boolean} [widthIsBitmap] - whether width is already in bitmap coordinates
 * @returns {{position: number, length: number}} Position of of the start point and length dimension.
 */
export function positionsLine(
	positionMedia,
	pixelRatio,
	desiredWidthMedia = 1,
	widthIsBitmap
) {
	const scaledPosition = Math.round(pixelRatio * positionMedia);
	const lineBitmapWidth = widthIsBitmap
		? desiredWidthMedia
		: Math.round(desiredWidthMedia * pixelRatio);
	const offset = centreOffset(lineBitmapWidth);
	const position = scaledPosition - offset;
	return { position, length: lineBitmapWidth };
}

/**
 * Determines the bitmap position and length for a dimension of a shape to be drawn.
 * @param {number} position1Media - media coordinate for the first point
 * @param {number} position2Media - media coordinate for the second point
 * @param {number} pixelRatio - pixel ratio for the corresponding axis (vertical or horizontal)
 * @returns {{position: number, length: number}} Position of of the start point and length dimension.
 */
export function positionsBox(
	position1Media,
	position2Media,
	pixelRatio
) {
	const scaledPosition1 = Math.round(pixelRatio * position1Media);
	const scaledPosition2 = Math.round(pixelRatio * position2Media);
	return {
		position: Math.min(scaledPosition1, scaledPosition2),
		length: Math.abs(scaledPosition2 - scaledPosition1) + 1,
	};
}
