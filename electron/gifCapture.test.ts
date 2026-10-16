import { describe, expect, it, vi } from "vitest";

vi.mock("./ipc/ffmpeg/binary", () => ({ getFfmpegBinaryPath: () => "ffmpeg" }));

import { buildGifConversionArgs, GIF_FRAME_RATE, GIF_MAX_WIDTH } from "./gifCapture";

describe("buildGifConversionArgs", () => {
	it("converts the whole clip to a looping, silent, palette-optimized GIF", () => {
		const args = buildGifConversionArgs("/rec/in.mp4", "/out/clip.gif");
		expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual([
			"-i",
			"/rec/in.mp4",
		]);
		expect(args).toContain("-an");
		expect(args.slice(-3)).toEqual(["-loop", "0", "/out/clip.gif"]);
		const filter = args[args.indexOf("-filter_complex") + 1];
		expect(filter).toContain("fps=" + GIF_FRAME_RATE);
		expect(filter).toContain("scale='min(" + GIF_MAX_WIDTH + ",iw)':-1");
		expect(filter).toContain("palettegen");
		expect(filter).toContain("paletteuse");
	});

	it("passes paths as discrete arguments so spaces need no quoting", () => {
		const args = buildGifConversionArgs("C:/My Videos/a b.mp4", "C:/Out Dir/x y.gif");
		expect(args).toContain("C:/My Videos/a b.mp4");
		expect(args.at(-1)).toBe("C:/Out Dir/x y.gif");
	});
});
