export type ScreenshotRect = { x: number; y: number; width: number; height: number };
export type ScreenshotDocument = {
	dataUrl: string;
	width: number;
	height: number;
	pinned: boolean;
};
export type ScreenshotResult = { success: boolean; canceled?: boolean; error?: string };

/** Display coordinates are DIP; PNG crop coordinates are physical pixels. */
export function screenshotPixelRect(
	rect: ScreenshotRect,
	display: ScreenshotRect,
	pixels: { width: number; height: number },
): ScreenshotRect {
	if (
		![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
		rect.width <= 0 ||
		rect.height <= 0
	)
		throw new Error("Choose a non-empty screenshot area.");
	const left = Math.max(display.x, rect.x);
	const top = Math.max(display.y, rect.y);
	const right = Math.min(display.x + display.width, rect.x + rect.width);
	const bottom = Math.min(display.y + display.height, rect.y + rect.height);
	if (right <= left || bottom <= top) throw new Error("The area is outside this display.");
	const x = Math.round(((left - display.x) * pixels.width) / display.width);
	const y = Math.round(((top - display.y) * pixels.height) / display.height);
	return {
		x,
		y,
		width: Math.round(((right - display.x) * pixels.width) / display.width) - x,
		height: Math.round(((bottom - display.y) * pixels.height) / display.height) - y,
	};
}
