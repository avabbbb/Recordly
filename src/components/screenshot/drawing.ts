export type Point = { x: number; y: number };
export type Annotation = {
	kind: "rectangle" | "arrow" | "text" | "mosaic" | "number";
	start: Point;
	end: Point;
	color: string;
	text: string;
};

export function drawScreenshot(
	ctx: CanvasRenderingContext2D,
	image: CanvasImageSource,
	annotations: Annotation[],
) {
	ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
	for (const item of annotations) {
		ctx.save();
		ctx.strokeStyle = item.color;
		ctx.fillStyle = item.color;
		ctx.lineWidth = 3;
		ctx.lineCap = "round";
		ctx.font = "22px sans-serif";
		const x = Math.min(item.start.x, item.end.x),
			y = Math.min(item.start.y, item.end.y);
		const width = Math.abs(item.end.x - item.start.x),
			height = Math.abs(item.end.y - item.start.y);
		if (item.kind === "rectangle") ctx.strokeRect(x, y, width, height);
		else if (item.kind === "arrow") {
			const angle = Math.atan2(item.end.y - item.start.y, item.end.x - item.start.x);
			ctx.beginPath();
			ctx.moveTo(item.start.x, item.start.y);
			ctx.lineTo(item.end.x, item.end.y);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(item.end.x, item.end.y);
			ctx.lineTo(
				item.end.x - 18 * Math.cos(angle - Math.PI / 6),
				item.end.y - 18 * Math.sin(angle - Math.PI / 6),
			);
			ctx.lineTo(
				item.end.x - 18 * Math.cos(angle + Math.PI / 6),
				item.end.y - 18 * Math.sin(angle + Math.PI / 6),
			);
			ctx.closePath();
			ctx.fill();
		} else if (item.kind === "text") ctx.fillText(item.text, item.start.x, item.start.y + 22);
		else if (item.kind === "number") {
			ctx.beginPath();
			ctx.arc(item.start.x, item.start.y, 15, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "#ffffff";
			ctx.font = "bold 19px sans-serif";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(item.text, item.start.x, item.start.y);
		} else if (item.kind === "mosaic" && width >= 1 && height >= 1) {
			const small = document.createElement("canvas");
			small.width = Math.max(1, Math.ceil(width / 14));
			small.height = Math.max(1, Math.ceil(height / 14));
			const smallCtx = small.getContext("2d");
			if (!smallCtx) throw new Error("Could not create the mosaic canvas.");
			smallCtx.drawImage(ctx.canvas, x, y, width, height, 0, 0, small.width, small.height);
			ctx.imageSmoothingEnabled = false;
			ctx.drawImage(small, 0, 0, small.width, small.height, x, y, width, height);
		}
		ctx.restore();
	}
}
