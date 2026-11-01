import { ArrayBufferTarget, Muxer } from "./mp4-muxer.mjs";

function fit(width, height) {
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const w = Math.max(2, Math.round((width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((height * scale) / 2) * 2);
  return { w, h };
}

function paintNode(ctx, el, vw, vh) {
  if (!el || el.nodeType !== 1) return;
  const tag = el.tagName;
  if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return;
  const rect = el.getBoundingClientRect();
  const outside = rect.bottom < -40 || rect.top > vh + 40 || rect.right < -40 || rect.left > vw + 40;
  if (outside && style.position !== "fixed") return;
  const opacity = Number(style.opacity);
  ctx.save();
  if (opacity < 1) ctx.globalAlpha *= opacity;
  if (style.overflow === "hidden" || style.overflowX === "hidden" || style.overflowY === "hidden") {
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
  }
  const bg = style.backgroundColor;
  if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
    ctx.fillStyle = bg;
    ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
  }
  if (tag === "IMG" && el.complete && el.naturalWidth) {
    try { ctx.drawImage(el, rect.left, rect.top, rect.width, rect.height); } catch { /* a kép kimarad */ }
  }
  if (tag === "CANVAS" && el.width && el.height) {
    try { ctx.drawImage(el, rect.left, rect.top, rect.width, rect.height); } catch { /* a vászon kimarad */ }
  }
  const border = Number.parseFloat(style.borderTopWidth);
  if (border > 0 && style.borderTopStyle !== "none") {
    ctx.strokeStyle = style.borderTopColor;
    ctx.lineWidth = border;
    ctx.strokeRect(rect.left + border / 2, rect.top + border / 2, Math.max(0, rect.width - border), Math.max(0, rect.height - border));
  }
  if (tag === "INPUT" && el.type === "checkbox") {
    ctx.strokeStyle = "#1c1917";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.left + 1, rect.top + 1, rect.width - 2, rect.height - 2);
    if (el.checked) {
      ctx.fillStyle = "#1c1917";
      ctx.fillRect(rect.left + 4, rect.top + 4, Math.max(1, rect.width - 8), Math.max(1, rect.height - 8));
    }
  }
  const direct = Array.from(el.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent.trim()).filter(Boolean).join(" ");
  if (direct && tag !== "CANVAS" && tag !== "IMG") {
    ctx.fillStyle = style.color;
    ctx.font = style.font;
    ctx.textBaseline = "middle";
    const align = style.textAlign;
    ctx.textAlign = align === "center" || align === "right" ? align : "left";
    let x = rect.left + (Number.parseFloat(style.paddingLeft) || 6);
    if (align === "center") x = rect.left + rect.width / 2;
    if (align === "right") x = rect.right - (Number.parseFloat(style.paddingRight) || 6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.left, rect.top, rect.width, rect.height);
    ctx.clip();
    ctx.fillText(direct.replace(/\s+/g, " "), x, rect.top + rect.height / 2);
    ctx.restore();
  }
  for (const child of el.children) paintNode(ctx, child, vw, vh);
  ctx.restore();
}

function paintCursor(ctx, mouse, now) {
  ctx.save();
  ctx.translate(mouse.x, mouse.y);
  if (mouse.down) ctx.scale(0.86, 0.86);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(4.5, 13.5);
  ctx.lineTo(8, 20);
  ctx.lineTo(10.5, 19);
  ctx.lineTo(7, 12.5);
  ctx.lineTo(13, 12.5);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#1c1917";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
  if (now < mouse.clickUntil) {
    const age = 1 - (mouse.clickUntil - now) / 280;
    ctx.beginPath();
    ctx.arc(mouse.clickX, mouse.clickY, 6 + age * 16, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(28, 25, 23, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export async function startFloorMp4() {
  if (typeof VideoEncoder === "undefined") throw new Error("nincs enkóder");
  const viewW = Math.max(2, document.documentElement.clientWidth || 800);
  const viewH = Math.max(2, document.documentElement.clientHeight || 600);
  const size = fit(viewW, viewH);
  const film = document.createElement("canvas");
  film.width = size.w;
  film.height = size.h;
  const ctx = film.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("nincs vászon");
  const codecs = ["avc1.640028", "avc1.4d0028", "avc1.420028"];
  let codec = "";
  for (const item of codecs) {
    const support = await VideoEncoder.isConfigSupported({
      codec: item,
      width: size.w,
      height: size.h,
      bitrate: 2_500_000,
      framerate: 10,
      avc: { format: "avc" },
    });
    if (support.supported) {
      codec = item;
      break;
    }
  }
  if (!codec) throw new Error("nincs mp4");
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: size.w, height: size.h, frameRate: 10 },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let meta = undefined;
  let failed = null;
  const encoder = new VideoEncoder({
    output: (chunk, chunkMeta) => {
      if (chunkMeta) meta = chunkMeta;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const timestamp = Number.isFinite(chunk.timestamp) ? chunk.timestamp : 0;
      const duration = Number.isFinite(chunk.duration) ? chunk.duration : 100000;
      muxer.addVideoChunkRaw(data, chunk.type, timestamp, duration, meta);
    },
    error: (error) => {
      failed = error;
    },
  });
  encoder.configure({
    codec,
    width: size.w,
    height: size.h,
    bitrate: 2_500_000,
    framerate: 10,
    avc: { format: "avc" },
    latencyMode: "quality",
  });
  const mouse = { x: viewW / 2, y: viewH / 2, down: false, clickX: 0, clickY: 0, clickUntil: 0 };
  const move = (event) => { mouse.x = event.clientX; mouse.y = event.clientY; };
  const down = (event) => { mouse.down = true; move(event); mouse.clickX = event.clientX; mouse.clickY = event.clientY; mouse.clickUntil = performance.now() + 280; };
  const up = () => { mouse.down = false; };
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  let live = true;
  let frames = 0;
  let last = 0;
  const push = (now) => {
    const vw = document.documentElement.clientWidth || viewW;
    const vh = document.documentElement.clientHeight || viewH;
    try {
      ctx.setTransform(size.w / vw, 0, 0, size.h / vh, 0, 0);
      ctx.fillStyle = "#fafaf9";
      ctx.fillRect(0, 0, vw, vh);
      paintNode(ctx, document.body, vw, vh);
      paintCursor(ctx, mouse, now);
    } catch {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#fafaf9";
      ctx.fillRect(0, 0, size.w, size.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const videoFrame = new VideoFrame(film, { timestamp: frames * 100000, duration: 100000 });
    encoder.encode(videoFrame, { keyFrame: frames % 10 === 0 });
    videoFrame.close();
    frames += 1;
  };
  const tick = (now) => {
    if (!live) return;
    if (now - last >= 100) {
      last = now;
      push(now);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    async stop() {
      live = false;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      if (!frames) push(performance.now());
      await encoder.flush();
      if (failed) throw failed;
      encoder.close();
      muxer.finalize();
      return new Blob([target.buffer], { type: "video/mp4" });
    },
  };
}
