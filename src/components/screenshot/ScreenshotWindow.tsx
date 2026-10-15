import {
	type CSSProperties,
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { ScreenshotDocument } from "@/lib/screenshot";
import { type Annotation, drawScreenshot, type Point } from "./drawing";
import "./screenshot.css";

export default function ScreenshotWindow() {
	const [doc, setDoc] = useState<ScreenshotDocument | null>(null);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [busy, setBusy] = useState(false);
	const [tool, setTool] = useState<Annotation["kind"]>("rectangle");
	const [color, setColor] = useState("#ff4545");
	const [text, setText] = useState("Text");
	const [editingText, setEditingText] = useState<number | null>(null);
	const [opacity, setOpacity] = useState(1);
	const [zoom, setZoom] = useState(1);
	const [history, setHistory] = useState<{ entries: Annotation[][]; index: number }>({
		entries: [[]],
		index: 0,
	});
	const [draft, setDraft] = useState<Annotation | null>(null);
	const annotations = history.entries[history.index];
	const canvas = useRef<HTMLCanvasElement>(null);
	const original = useRef<HTMLImageElement | null>(null);
	const gesture = useRef<Annotation | null>(null);
	const colorValid =
		/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba?\()/i.test(color) && CSS.supports("color", color);
	useEffect(() => {
		let disposed = false;
		void window.electronAPI
			.getScreenshotDocument()
			.then(async (value) => {
				const image = new Image();
				image.src = value.dataUrl;
				await image.decode();
				if (disposed) return;
				original.current = image;
				setDoc(value);
				if (value.pinned) setZoom(window.innerWidth / value.width);
			})
			.catch((error) => {
				if (!disposed) setError(String(error));
			});
		return () => {
			disposed = true;
			original.current = null;
		};
	}, []);
	useEffect(() => {
		if (!doc || doc.pinned) return;
		const ctx = canvas.current?.getContext("2d");
		if (ctx && original.current)
			drawScreenshot(ctx, original.current, draft ? [...annotations, draft] : annotations);
	}, [doc, annotations, draft]);
	const action = useCallback(
		async (kind: "copy" | "save" | "pin" | "close", value?: number) => {
			if (busy || !doc) return;
			setBusy(true);
			setError("");
			setNotice("");
			try {
				const png =
					kind === "close" || doc.pinned
						? undefined
						: canvas.current!.toDataURL("image/png");
				const result = await window.electronAPI.screenshotAction(kind, value ?? png);
				if (!result.success) throw new Error(result.error);
				if (!result.canceled && kind !== "close")
					setNotice(
						kind === "copy"
							? "Copied image"
							: kind === "pin"
								? "Pinned to desktop"
								: "Saved PNG",
					);
			} catch (error) {
				setError(String(error));
			} finally {
				setBusy(false);
			}
		},
		[busy, doc],
	);
	const undo = useCallback(() => {
		setEditingText(null);
		setHistory((value) => ({ ...value, index: Math.max(0, value.index - 1) }));
	}, []);
	const redo = useCallback(() => {
		setEditingText(null);
		setHistory((value) => ({
			...value,
			index: Math.min(value.entries.length - 1, value.index + 1),
		}));
	}, []);
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if ((event.target as HTMLElement).matches("input,textarea")) return;
			if (event.key === "Escape") {
				void action("close");
				return;
			}
			if (event.ctrlKey || event.metaKey) {
				if (event.key.toLowerCase() === "z") {
					event.preventDefault();
					if (event.shiftKey) redo();
					else undo();
				}
				if (event.key.toLowerCase() === "y") {
					event.preventDefault();
					redo();
				}
				if (event.key.toLowerCase() === "c") {
					event.preventDefault();
					void action("copy");
				}
				if (event.key.toLowerCase() === "s") {
					event.preventDefault();
					void action("save");
				}
			}
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [action, undo, redo]);
	const commit = (item: Annotation) => {
		setEditingText(item.kind === "text" ? annotations.length : null);
		setHistory((value) => ({
			entries: [
				...value.entries.slice(0, value.index + 1),
				[...value.entries[value.index], item],
			],
			index: value.index + 1,
		}));
		setDraft(null);
		gesture.current = null;
	};
	const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
		const element = event.currentTarget,
			rect = element.getBoundingClientRect();
		return {
			x: Math.max(
				0,
				Math.min(element.width, ((event.clientX - rect.left) * element.width) / rect.width),
			),
			y: Math.max(
				0,
				Math.min(
					element.height,
					((event.clientY - rect.top) * element.height) / rect.height,
				),
			),
		};
	};
	const adjustPin = async (kind: "opacity" | "zoom", value: number) => {
		try {
			const result = await window.electronAPI.screenshotAction(kind, value);
			if (!result.success) throw new Error(result.error);
			if (kind === "opacity") setOpacity(value);
			else setZoom(value);
		} catch (error) {
			setError(String(error));
		}
	};
	if (!doc)
		return (
			<main className="screenshot-app">
				<p role={error ? "alert" : "status"}>{error || "Loading screenshot…"}</p>
			</main>
		);
	if (doc.pinned)
		return (
			<main className="screenshot-app screenshot-pin">
				<header className="pin-bar" style={{ WebkitAppRegion: "drag" } as CSSProperties}>
					<span>{notice || "Drag to move"}</span>
					<div style={{ WebkitAppRegion: "no-drag" } as CSSProperties}>
						<button disabled={busy} onClick={() => void action("copy")}>
							Copy
						</button>
						<button disabled={busy} onClick={() => void action("save")}>
							Save
						</button>
						<button aria-label="Close pin" onClick={() => void action("close")}>
							×
						</button>
					</div>
				</header>
				<img
					className="pinned-image"
					src={doc.dataUrl}
					alt="Pinned screenshot"
					draggable={false}
					onWheel={(event) => {
						event.preventDefault();
						void adjustPin(
							"zoom",
							Math.max(0.1, Math.min(3, zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))),
						);
					}}
				/>
				<label className="pin-opacity">
					Opacity{" "}
					<input
						aria-label="Pin opacity"
						type="range"
						min="0.2"
						max="1"
						step="0.05"
						value={opacity}
						onChange={(event) => void adjustPin("opacity", Number(event.target.value))}
					/>
				</label>
				{error && <p role="alert">{error}</p>}
			</main>
		);
	return (
		<main className="screenshot-app">
			<header className="screenshot-toolbar">
				<strong>
					Screenshot{" "}
					<small>
						{doc.width} × {doc.height}
					</small>
				</strong>
				<div
					className="screenshot-tools"
					role="toolbar"
					aria-label="Screenshot annotation tools"
				>
					{(["rectangle", "arrow", "text", "mosaic", "number"] as const).map((kind) => (
						<button
							key={kind}
							aria-pressed={tool === kind}
							onClick={() => {
								setTool(kind);
								setEditingText(null);
							}}
						>
							{kind[0].toUpperCase() + kind.slice(1)}
						</button>
					))}
					<label>
						Color{" "}
						<input
							aria-label="Annotation color"
							value={color}
							aria-invalid={!colorValid}
							onChange={(event) => setColor(event.target.value)}
							placeholder="#ff4545 or rgb(255,69,69)"
						/>
					</label>
					<span
						className="color-preview"
						style={{ background: colorValid ? color : "transparent" }}
					/>
					<label>
						Text{" "}
						<input
							aria-label="Annotation text"
							value={text}
							onChange={(event) => {
								const value = event.target.value;
								setText(value);
								if (editingText !== null)
									setHistory((state) => {
										const changed = state.entries[state.index].map(
											(item, index) =>
												index === editingText
													? { ...item, text: value }
													: item,
										);
										return {
											entries: [
												...state.entries.slice(0, state.index + 1),
												changed,
											],
											index: state.index + 1,
										};
									});
							}}
						/>
					</label>
				</div>
				<div className="screenshot-tools">
					<button onClick={undo} disabled={!history.index}>
						Undo
					</button>
					<button onClick={redo} disabled={history.index === history.entries.length - 1}>
						Redo
					</button>
					<span className="toolbar-spacer" />
					<button disabled={busy} onClick={() => void action("copy")}>
						Copy image
					</button>
					<button disabled={busy} onClick={() => void action("save")}>
						Save PNG
					</button>
					<button disabled={busy} onClick={() => void action("pin")}>
						Pin to desktop
					</button>
					<button onClick={() => void action("close")}>Close</button>
				</div>
			</header>
			<div className="screenshot-canvas-area">
				<canvas
					ref={canvas}
					width={doc.width}
					height={doc.height}
					aria-label="Screenshot canvas"
					onPointerDown={(event) => {
						if (event.button !== 0 || !colorValid) return;
						const start = point(event);
						const item: Annotation = {
							kind: tool,
							start,
							end: start,
							color,
							text:
								tool === "number"
									? String(
											annotations.filter((item) => item.kind === "number")
												.length + 1,
										)
									: text,
						};
						if (tool === "text" || tool === "number") {
							commit(item);
							return;
						}
						gesture.current = item;
						setDraft(item);
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
					onPointerMove={(event) => {
						if (gesture.current) {
							gesture.current = { ...gesture.current, end: point(event) };
							setDraft(gesture.current);
						}
					}}
					onPointerUp={(event) => {
						if (gesture.current) commit({ ...gesture.current, end: point(event) });
						if (event.currentTarget.hasPointerCapture(event.pointerId))
							event.currentTarget.releasePointerCapture(event.pointerId);
					}}
					onPointerCancel={() => {
						gesture.current = null;
						setDraft(null);
					}}
				/>
			</div>
			<footer role={error || !colorValid ? "alert" : "status"}>
				{error ||
					(!colorValid
						? "Enter a valid HEX or RGB color."
						: notice ||
							"Draw on the image · Ctrl/Cmd+Z undo · Ctrl/Cmd+C copy · Ctrl/Cmd+S save")}
			</footer>
		</main>
	);
}
