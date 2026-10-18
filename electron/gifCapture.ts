import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegBinaryPath } from "./ipc/ffmpeg/binary";

const run = promisify(execFile);

// Direct GIF capture skips the editor (and its WebGL/WebCodecs renderer) entirely:
// the finished recording is converted in the main process with the bundled ffmpeg,
// using a per-clip palette so screen content stays crisp at a small file size.
export const GIF_FRAME_RATE = 15;
export const GIF_MAX_WIDTH = 960;
const GIF_CONVERT_TIMEOUT_MS = 600_000;
const GIF_CONVERT_MAX_BUFFER_BYTES = 10_485_760;

export function buildGifConversionArgs(inputPath: string, outputPath: string): string[] {
	const filter =
		"fps=" +
		GIF_FRAME_RATE +
		",scale='min(" +
		GIF_MAX_WIDTH +
		",iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-nostdin",
		"-y",
		"-i",
		inputPath,
		"-an",
		"-filter_complex",
		filter,
		"-loop",
		"0",
		outputPath,
	];
}

export async function convertVideoToGif(inputPath: string, outputPath: string) {
	await run(getFfmpegBinaryPath(), buildGifConversionArgs(inputPath, outputPath), {
		timeout: GIF_CONVERT_TIMEOUT_MS,
		maxBuffer: GIF_CONVERT_MAX_BUFFER_BYTES,
		windowsHide: true,
	});
}
