import { expect, test } from "@playwright/test";
import { installDesktopBridge, installDesktopBridgeOverrides } from "./bridge";

async function installScreenshot(page: import("@playwright/test").Page, pinned = false) {
	await installDesktopBridge(page);
	await installDesktopBridgeOverrides(
		page,
		(pinned) => {
			const image = () => {
				const canvas = document.createElement("canvas");
				canvas.width = 640;
				canvas.height = 360;
				const ctx = canvas.getContext("2d")!;
				ctx.fillStyle = "#ffffff";
				ctx.fillRect(0, 0, 640, 360);
				ctx.fillStyle = "#111111";
				for (let y = 0; y < 360; y += 8)
					for (let x = 0; x < 640; x += 8)
						if ((x + y) % 16 === 0) ctx.fillRect(x, y, 8, 8);
				return canvas.toDataURL();
			};
			Object.assign(window.electronAPI, {
				getScreenshotDocument: async () => ({
					dataUrl: image(),
					width: 640,
					height: 360,
					pinned,
				}),
				getScreenshotContext: async () => ({
					displayBounds: { x: -1440, y: 0, width: 1440, height: 1000 },
					allowArea: true,
					windows: [],
					cursor: null,
					background: image(),
				}),
				completeScreenshotPick: async (pick: unknown) => {
					document.documentElement.dataset.screenshotPick = JSON.stringify(pick);
					return { success: true };
				},
				screenshotAction: async (action: string, value?: string | number) => {
					document.documentElement.dataset.screenshotAction = action;
					if (typeof value === "string")
						document.documentElement.dataset.exportedPng = value;
					if (typeof value === "number")
						document.documentElement.dataset.pinValue = String(value);
					return { success: true };
				},
			});
		},
		pinned,
	);
}

test("Windows screenshot mode draws areas on the frozen display without changing recording selection", async ({
	page,
}) => {
	await installScreenshot(page);
	await page.goto("/?windowType=capture-picker&purpose=screenshot&displayId=1");
	await expect(page.getByAltText("Captured display")).toBeVisible();
	await page.mouse.move(200, 200);
	await page.mouse.down();
	await page.mouse.move(600, 450, { steps: 8 });
	await page.mouse.up();
	await page.getByRole("button", { name: "Capture screenshot", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute(
		"data-screenshot-pick",
		JSON.stringify({ displayId: 1, rect: { x: -1240, y: 200, width: 400, height: 250 } }),
	);
	await expect(page.locator("html")).not.toHaveAttribute("data-pick");
});

test("annotations are flattened into identical copy/save/pin PNGs; undo and redo restore pixels", async ({
	page,
}) => {
	await installScreenshot(page);
	await page.goto("/?windowType=screenshot");
	const canvas = page.getByLabel("Screenshot canvas");
	await expect(canvas).toBeVisible();
	const original = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
	const box = (await canvas.boundingBox())!;
	await page.getByLabel("Annotation color").fill("rgb(255,0,0)");
	await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 8 });
	await page.mouse.up();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL()))
		.toBe(original);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect
		.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL()))
		.not.toBe(original);
	await page.getByRole("button", { name: "Text", exact: true }).click();
	await page.getByLabel("Annotation text").fill("Review this");
	await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.3 } });
	const textBefore = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
	await page.getByLabel("Annotation text").fill("Updated label");
	await expect
		.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL()))
		.not.toBe(textBefore);
	await page.getByRole("button", { name: "Arrow", exact: true }).click();
	await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2, { steps: 4 });
	await page.mouse.up();
	await page.getByRole("button", { name: "Number", exact: true }).click();
	await canvas.click({ position: { x: box.width * 0.8, y: box.height * 0.5 } });
	await page.getByRole("button", { name: "Copy image", exact: true }).click();
	const png = await page.locator("html").getAttribute("data-exported-png");
	expect(png).toMatch(/^data:image\/png;base64,/);
	expect(png).not.toBe(original);
	await page.getByRole("button", { name: "Save PNG", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-exported-png", png!);
	await page.getByRole("button", { name: "Pin to desktop", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-exported-png", png!);
	await page.screenshot({ path: "test-results/screenshot-editor.png" });
});

test("mosaic changes captured pixels and invalid colors do not draw", async ({ page }) => {
	await installScreenshot(page);
	await page.goto("/?windowType=screenshot");
	const canvas = page.getByLabel("Screenshot canvas");
	await expect(canvas).toBeVisible();
	const original = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
	await page.getByLabel("Annotation color").fill("definitely invalid");
	await canvas.click();
	await expect(page.getByLabel("Annotation color")).toHaveAttribute("aria-invalid", "true");
	expect(await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL())).toBe(original);
	await page.getByLabel("Annotation color").fill("#ff0000");
	await page.getByRole("button", { name: "Mosaic", exact: true }).click();
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + 50, box.y + 50);
	await page.mouse.down();
	await page.mouse.move(box.x + 250, box.y + 180, { steps: 5 });
	await page.mouse.up();
	await expect
		.poll(() => canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL()))
		.not.toBe(original);
});

test("a pinned image exposes copy, opacity, wheel zoom and close", async ({ page }) => {
	await installScreenshot(page, true);
	await page.goto("/?windowType=screenshot&pinned=true");
	await expect(page.getByAltText("Pinned screenshot")).toBeVisible();
	await page.getByLabel("Pin opacity").fill("0.5");
	await expect(page.locator("html")).toHaveAttribute("data-pin-value", "0.5");
	await page.getByAltText("Pinned screenshot").hover();
	await page.mouse.wheel(0, -100);
	await expect(page.locator("html")).toHaveAttribute("data-screenshot-action", "zoom");
	await page.getByRole("button", { name: "Copy", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screenshot-action", "copy");
	await page.getByRole("button", { name: "Close pin", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-screenshot-action", "close");
});
