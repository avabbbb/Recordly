import { describe, expect, it } from "vitest";
import { screenshotPixelRect } from "./screenshot";

describe("screenshot DIP to physical pixel crop", () => {
	it("handles a negative-origin Retina display without global scaling", () => {
		expect(
			screenshotPixelRect(
				{ x: -1550, y: 70, width: 301, height: 199 },
				{ x: -1600, y: 0, width: 1600, height: 900 },
				{ width: 3200, height: 1800 },
			),
		).toEqual({ x: 100, y: 140, width: 602, height: 398 });
	});
	it("uses rounded endpoints at fractional DPI and clips to one display", () => {
		expect(
			screenshotPixelRect(
				{ x: 99, y: -10, width: 104, height: 111 },
				{ x: 100, y: 0, width: 800, height: 600 },
				{ width: 1000, height: 750 },
			),
		).toEqual({ x: 0, y: 0, width: 129, height: 126 });
	});
	it.each([
		{ x: NaN, y: 1, width: 10, height: 10 },
		{ x: 1, y: 1, width: -1, height: 10 },
		{ x: 5000, y: 0, width: 10, height: 10 },
	])("rejects invalid and disjoint selections", (rect) => {
		expect(() =>
			screenshotPixelRect(
				rect,
				{ x: 0, y: 0, width: 800, height: 600 },
				{ width: 800, height: 600 },
			),
		).toThrow();
	});
});
