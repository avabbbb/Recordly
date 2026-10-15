import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	let nextId = 10;
	class Window {
		webContents = { id: nextId++ };
		events = new Map<string, () => void>();
		loadFile = vi.fn();
		loadURL = vi.fn();
		show = vi.fn();
		setOpacity = vi.fn();
		setSize = vi.fn();
		getBounds = () => ({ x: 0, y: 0, width: 600, height: 300 });
		once = (event: string, callback: () => void) => {
			this.events.set(event, callback);
		};
		close = vi.fn(() => this.events.get("closed")?.());
		constructor(public options: Record<string, unknown>) {
			instances.push(this);
		}
	}
	const instances: Window[] = [];
	return {
		handlers: new Map<string, (...args: unknown[]) => unknown>(),
		Window,
		instances,
		getSources: vi.fn(),
		write: vi.fn(),
		clipboard: vi.fn(),
		save: vi.fn(),
		create: vi.fn(),
		close: vi.fn(),
		pickers: [] as object[],
		overlay: {},
		recording: false,
		hud: {
			isVisible: () => true,
			isDestroyed: () => false,
			hide: vi.fn(),
			showInactive: vi.fn(),
		},
		decode: vi.fn(),
	};
});
vi.mock("electron", () => ({
	BrowserWindow: mocks.Window,
	clipboard: { writeImage: mocks.clipboard },
	desktopCapturer: { getSources: mocks.getSources },
	dialog: { showSaveDialog: mocks.save },
	nativeImage: { createFromDataURL: mocks.decode },
	ipcMain: {
		handle: (key: string, callback: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(key, callback),
	},
}));
vi.mock("node:fs/promises", () => ({ default: { writeFile: mocks.write } }));
vi.mock("./ipc/capturePickerSources", () => ({ listCapturePickerWindows: async () => [] }));
vi.mock("./ipc/state", () => ({
	get isCursorCaptureActive() {
		return mocks.recording;
	},
}));
vi.mock("./ipc/utils", () => ({
	getScreen: () => ({
		getAllDisplays: () => [
			{
				id: 1,
				bounds: { x: -1000, y: 0, width: 1000, height: 500 },
				size: { width: 1000, height: 500 },
				scaleFactor: 2,
			},
		],
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
		getDisplayNearestPoint: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
	}),
}));
vi.mock("./windows", () => ({
	getHudOverlayWindow: () => mocks.hud,
	getCapturePickerWindows: () => mocks.pickers,
	createCapturePickerWindows: mocks.create,
	closeCapturePickerWindows: mocks.close,
	isCapturePickerWebContents: (sender: object) => sender === mocks.overlay,
}));
function image(width: number, height: number, name = "original") {
	return {
		getSize: () => ({ width, height }),
		isEmpty: () => false,
		toDataURL: () => `data:image/png;base64,${name}`,
		toPNG: () => Buffer.from(name),
		crop: vi.fn((rect: { width: number; height: number }) =>
			image(rect.width, rect.height, "crop"),
		),
	};
}
const invoke = (name: string, sender: object, ...args: unknown[]) =>
	mocks.handlers.get(name)!({ sender }, ...args);
async function selectedDocument() {
	await invoke("start-screenshot", {});
	await invoke("complete-screenshot-pick", mocks.overlay, {
		displayId: 1,
		rect: { x: -950, y: 50, width: 300, height: 150 },
	});
	return mocks.instances[0];
}

describe("screenshot native IPC and resource ownership", () => {
	const platform = process.platform;
	afterEach(() => {
		Object.defineProperty(process, "platform", { value: platform });
	});
	beforeEach(async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		vi.resetModules();
		vi.clearAllMocks();
		mocks.handlers.clear();
		mocks.instances.length = 0;
		mocks.recording = false;
		mocks.pickers = [];
		mocks.getSources.mockResolvedValue([{ display_id: "1", thumbnail: image(2000, 1000) }]);
		mocks.save.mockResolvedValue({ canceled: false, filePath: "/screenshot.png" });
		mocks.decode.mockReturnValue(image(600, 300, "edited"));
		const { registerScreenshotHandlers } = await import("./screenshot");
		registerScreenshotHandlers();
	});
	it("captures at native DPI, crops negative-origin rectangles and restores the HUD", async () => {
		const doc = await selectedDocument();
		expect(mocks.getSources).toHaveBeenCalledWith({
			types: ["screen"],
			thumbnailSize: { width: 2000, height: 1000 },
		});
		expect(mocks.create).toHaveBeenCalledWith(expect.any(Function), "screenshot");
		expect(mocks.hud.hide).toHaveBeenCalledOnce();
		expect(mocks.hud.showInactive).toHaveBeenCalledOnce();
		expect(invoke("get-screenshot-document", doc.webContents)).toMatchObject({
			width: 600,
			height: 300,
			pinned: false,
		});
	});
	it("cancels selection and prevents a foreign window from reading screenshot pixels", async () => {
		await invoke("start-screenshot", {});
		expect(() => invoke("get-screenshot-context", {}, 1)).toThrow();
		await invoke("complete-screenshot-pick", mocks.overlay, null);
		expect(() => invoke("get-screenshot-context", mocks.overlay, 1)).toThrow();
		expect(mocks.instances).toHaveLength(0);
	});
	it("reports capture resolution failures and permits a subsequent retry", async () => {
		mocks.getSources.mockResolvedValueOnce([{ display_id: "1", thumbnail: image(1000, 500) }]);
		expect(await invoke("start-screenshot", {})).toMatchObject({
			success: false,
			error: expect.stringContaining("received 1000"),
		});
		expect(mocks.hud.showInactive).toHaveBeenCalledOnce();
		expect(await invoke("start-screenshot", {})).toEqual({ success: true });
	});
	it("copies and saves the composited PNG and pins an independently owned image", async () => {
		const doc = await selectedDocument();
		await invoke("screenshot-action", doc.webContents, "copy", "data:image/png;base64,edited");
		expect(mocks.clipboard).toHaveBeenCalledWith(
			expect.objectContaining({ toPNG: expect.any(Function) }),
		);
		await invoke("screenshot-action", doc.webContents, "save", "data:image/png;base64,edited");
		expect(mocks.write).toHaveBeenCalledWith("/screenshot.png", Buffer.from("edited"));
		await invoke("screenshot-action", doc.webContents, "pin", "data:image/png;base64,edited");
		const pin = mocks.instances[1];
		expect(pin.options).toMatchObject({ alwaysOnTop: true, frame: false });
		doc.close();
		expect(() => invoke("get-screenshot-document", doc.webContents)).toThrow();
		expect(invoke("get-screenshot-document", pin.webContents)).toMatchObject({ pinned: true });
	});
	it("save cancellation preserves the document and does not write a file", async () => {
		const doc = await selectedDocument();
		mocks.save.mockResolvedValueOnce({ canceled: true });
		expect(await invoke("screenshot-action", doc.webContents, "save")).toMatchObject({
			canceled: true,
		});
		expect(mocks.write).not.toHaveBeenCalled();
		expect(invoke("get-screenshot-document", doc.webContents)).toMatchObject({ width: 600 });
	});
	it("rejects mismatched exports and actions from unowned windows", async () => {
		const doc = await selectedDocument();
		mocks.decode.mockReturnValue(image(120, 30));
		await expect(
			invoke("screenshot-action", doc.webContents, "copy", "data:image/png;base64,bad"),
		).rejects.toThrow("dimensions");
		await expect(invoke("screenshot-action", {}, "copy")).rejects.toThrow("belongs");
		expect(mocks.clipboard).not.toHaveBeenCalled();
	});
	it("does not start during recording or an existing source selection", async () => {
		mocks.recording = true;
		expect(await invoke("start-screenshot", {})).toMatchObject({ success: false });
		mocks.recording = false;
		mocks.pickers = [{}];
		expect(await invoke("start-screenshot", {})).toMatchObject({ success: false });
		expect(mocks.getSources).not.toHaveBeenCalled();
	});
});
