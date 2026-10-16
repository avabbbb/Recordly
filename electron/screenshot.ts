import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	BrowserWindow,
	clipboard,
	desktopCapturer,
	dialog,
	ipcMain,
	type NativeImage,
	nativeImage,
} from "electron";
import { type ScreenshotRect, screenshotPixelRect } from "../src/lib/screenshot";
import { listCapturePickerWindows } from "./ipc/capturePickerSources";
import { isCursorCaptureActive } from "./ipc/state";
import { getScreen } from "./ipc/utils";
import {
	beginCaptureSelection,
	closeCapturePickerWindows,
	createCapturePickerWindows,
	endCaptureSelection,
	getHudOverlayWindow,
	isCapturePickerWebContents,
} from "./windows";

const mainDir = path.dirname(fileURLToPath(import.meta.url));
type Frame = { image: NativeImage; bounds: ScreenshotRect };
type Document = { image: NativeImage; window: BrowserWindow; pinned: boolean };

export function registerScreenshotHandlers() {
	let picking = false;
	const frames = new Map<number, Frame>();
	const documents = new Map<number, Document>();
	let restoreHud = false;
	let windows: Awaited<ReturnType<typeof listCapturePickerWindows>> = [];
	const finish = () => {
		closeCapturePickerWindows();
		frames.clear();
		picking = false;
		endCaptureSelection();
		const hud = getHudOverlayWindow();
		if (restoreHud && hud && !hud.isDestroyed()) hud.showInactive();
		restoreHud = false;
	};
	const openDocument = (image: NativeImage, pinned: boolean, bounds?: ScreenshotRect) => {
		const display = getScreen().getDisplayNearestPoint(getScreen().getCursorScreenPoint());
		const size = image.getSize();
		const scale = Math.min(
			1,
			(display.workAreaSize.width - 80) / size.width,
			(display.workAreaSize.height - 140) / size.height,
		);
		const win = new BrowserWindow({
			width: pinned
				? Math.max(240, Math.round(size.width * scale))
				: Math.min(
						display.workAreaSize.width - 40,
						Math.max(720, Math.round(size.width * scale)),
					),
			height: pinned
				? Math.max(180, Math.round(size.height * scale) + 57)
				: Math.min(
						display.workAreaSize.height - 40,
						Math.max(520, Math.round(size.height * scale) + 180),
					),
			...(pinned && bounds ? { x: Math.round(bounds.x), y: Math.round(bounds.y) } : {}),
			title: pinned ? "Recordly Pin" : "Recordly Screenshot",
			frame: !pinned,
			alwaysOnTop: pinned,
			skipTaskbar: pinned,
			show: false,
			backgroundColor: "#18181b",
			webPreferences: {
				preload: path.join(mainDir, "preload.mjs"),
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		documents.set(win.webContents.id, { image, window: win, pinned });
		const documentId = win.webContents.id;
		win.once("closed", () => documents.delete(documentId));
		win.once("ready-to-show", () => win.show());
		const query = { windowType: "screenshot", pinned: String(pinned) };
		const devUrl = process.env.VITE_DEV_SERVER_URL;
		if (devUrl) void win.loadURL(`${devUrl}?${new URLSearchParams(query)}`);
		else void win.loadFile(path.join(mainDir, "../dist/index.html"), { query });
		return win;
	};
	const start = async () => {
		if (isCursorCaptureActive)
			throw new Error("Stop the recording before taking a screenshot.");
		if (process.platform === "linux")
			throw new Error("Screenshot selection currently supports Windows and macOS.");
		if (!beginCaptureSelection()) throw new Error("Finish the current selection first.");
		picking = true;
		const hud = getHudOverlayWindow();
		restoreHud = Boolean(hud?.isVisible());
		if (restoreHud) hud?.hide();
		try {
			windows = await listCapturePickerWindows();
			for (const display of getScreen().getAllDisplays()) {
				const width = Math.round(display.size.width * display.scaleFactor);
				const height = Math.round(display.size.height * display.scaleFactor);
				const sources = await desktopCapturer.getSources({
					types: ["screen"],
					thumbnailSize: { width, height },
				});
				const image = sources.find(
					(source) => source.display_id === String(display.id),
				)?.thumbnail;
				if (!image || image.isEmpty())
					throw new Error(
						"Could not capture the display. Check screen recording permission.",
					);
				const actual = image.getSize();
				if (actual.width !== width || actual.height !== height)
					throw new Error(
						`Expected ${width}×${height} pixels, received ${actual.width}×${actual.height}.`,
					);
				frames.set(display.id, { image, bounds: display.bounds });
			}
			createCapturePickerWindows(finish, "screenshot");
		} catch (error) {
			finish();
			throw error;
		}
	};
	ipcMain.handle("start-screenshot", async () => {
		try {
			await start();
			return { success: true };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("get-screenshot-context", (event, displayId: number) => {
		if (!isCapturePickerWebContents(event.sender) || !picking)
			throw new Error("No screenshot selection is active.");
		const frame = frames.get(displayId);
		if (!frame) throw new Error("The display is no longer available.");
		return {
			displayBounds: frame.bounds,
			allowArea: true,
			lastArea: null,
			windows,
			cursor: getScreen().getCursorScreenPoint(),
			background: frame.image.toDataURL(),
		};
	});
	ipcMain.handle(
		"complete-screenshot-pick",
		(event, input: { displayId: number; rect: ScreenshotRect } | null) => {
			if (!isCapturePickerWebContents(event.sender) || !picking)
				throw new Error("No screenshot selection is active.");
			if (!input) {
				finish();
				return { success: true, canceled: true };
			}
			try {
				const frame = frames.get(input.displayId);
				if (!frame) throw new Error("The display is no longer available.");
				const image = frame.image.crop(
					screenshotPixelRect(input.rect, frame.bounds, frame.image.getSize()),
				);
				openDocument(image, false);
				finish();
				return { success: true };
			} catch (error) {
				return { success: false, error: String(error) };
			}
		},
	);
	ipcMain.handle("get-screenshot-document", (event) => {
		const doc = documents.get(event.sender.id);
		if (!doc) throw new Error("No screenshot belongs to this window.");
		return { dataUrl: doc.image.toDataURL(), ...doc.image.getSize(), pinned: doc.pinned };
	});
	ipcMain.handle(
		"screenshot-action",
		async (
			event,
			action: "copy" | "save" | "pin" | "close" | "opacity" | "zoom",
			value?: string | number,
		) => {
			const doc = documents.get(event.sender.id);
			if (!doc) throw new Error("No screenshot belongs to this window.");
			if (action === "close") {
				doc.window.close();
				return { success: true };
			}
			if (action === "opacity") {
				if (
					typeof value !== "number" ||
					!Number.isFinite(value) ||
					value < 0.2 ||
					value > 1
				)
					throw new Error("Invalid opacity.");
				doc.window.setOpacity(value);
				return { success: true };
			}
			if (action === "zoom") {
				if (
					typeof value !== "number" ||
					!Number.isFinite(value) ||
					value < 0.1 ||
					value > 3
				)
					throw new Error("Invalid zoom.");
				const size = doc.image.getSize();
				doc.window.setSize(
					Math.max(100, Math.round(size.width * value)),
					Math.max(80, Math.round(size.height * value) + 57),
				);
				return { success: true };
			}
			if (
				value !== undefined &&
				(typeof value !== "string" || !value.startsWith("data:image/png;base64,"))
			)
				throw new Error("Expected a PNG image.");
			const image =
				typeof value === "string" ? nativeImage.createFromDataURL(value) : doc.image;
			const originalSize = doc.image.getSize();
			const size = image.getSize();
			if (
				image.isEmpty() ||
				size.width !== originalSize.width ||
				size.height !== originalSize.height
			)
				throw new Error("Screenshot pixels must match the captured dimensions.");
			if (action === "copy") clipboard.writeImage(image);
			else if (action === "save") {
				const result = await dialog.showSaveDialog(doc.window, {
					defaultPath: `Screenshot-${Date.now()}.png`,
					filters: [{ name: "PNG image", extensions: ["png"] }],
				});
				if (result.canceled || !result.filePath) return { success: true, canceled: true };
				await fs.writeFile(result.filePath, image.toPNG());
			} else if (action === "pin") openDocument(image, true, doc.window.getBounds());
			else throw new Error("Unknown screenshot action.");
			return { success: true };
		},
	);
	return start;
}
