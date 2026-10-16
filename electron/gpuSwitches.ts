export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

function normalizeLinuxWindowSystem(value: string | undefined): "wayland" | "x11" | null {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "wayland" || normalized === "x11") {
		return normalized;
	}

	return null;
}

function getForcedLinuxWindowSystem(env: NodeJS.ProcessEnv): "wayland" | "x11" | null {
	return (
		normalizeLinuxWindowSystem(env.OZONE_PLATFORM) ??
		normalizeLinuxWindowSystem(env.ELECTRON_OZONE_PLATFORM_HINT)
	);
}

export function shouldForceLinuxEgl(env: NodeJS.ProcessEnv): boolean {
	const forcedWindowSystem = getForcedLinuxWindowSystem(env);
	if (forcedWindowSystem === "wayland") {
		return false;
	}
	if (forcedWindowSystem === "x11") {
		return true;
	}

	const sessionType = env.XDG_SESSION_TYPE?.toLowerCase();
	if (sessionType === "wayland") {
		return false;
	}
	if (sessionType === "x11") {
		return true;
	}

	return !env.WAYLAND_DISPLAY;
}

export function getGpuSwitches(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv = process.env,
): GpuSwitches {
	if (platform === "darwin") {
		return {
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		};
	}

	if (platform === "win32") {
		return { useAngle: "d3d11" };
	}

	if (platform === "linux") {
		return {
			useGl: shouldForceLinuxEgl(env) ? "egl" : undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}

/**
 * Lightweight mode (default ON): skip the aggressive global GPU switches that
 * measurably add ~300 MB of idle private memory (browser + GPU process).
 * The editor still gets WebGPU where Chromium enables it by default and falls
 * back to WebGL otherwise. Chromium switches are startup-only, so a change
 * takes effect on the next launch.
 */
export const LIGHTWEIGHT_MODE_SETTING_KEY = "lightweightMode";

export const PERFORMANCE_GPU_SWITCHES: readonly string[] = [
	"ignore-gpu-blocklist",
	"enable-unsafe-webgpu",
	"enable-gpu-rasterization",
];

export function resolveLightweightMode(
	storedValue: unknown,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (env.RECORDLY_SMOKE_EXPORT === "1") {
		return false;
	}
	if (env.RECORDLY_LIGHTWEIGHT === "0") {
		return false;
	}
	if (env.RECORDLY_LIGHTWEIGHT === "1") {
		return true;
	}
	return storedValue !== false;
}
