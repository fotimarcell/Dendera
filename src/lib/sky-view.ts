export type Cam = { orbit: number; tilt: number; height: number };

export const CAM_HOME: Cam = { orbit: 0, tilt: 18, height: 0.42 };

export type FloorSeg = { x1: number; y1: number; x2: number; y2: number; color: string; width: number };
export type SkyDot = { name: string; az: number; alt: number; color: string; dim?: boolean };
export type SkyArc = { points: { az: number; alt: number }[]; color: string };

type V3 = { x: number; y: number; z: number };
type P2 = { x: number; y: number; z: number };

function projector(w: number, h: number, cam: Cam) {
  const aspect = h / w;
  const radius = Math.hypot(1, aspect) * 1.12;
  const dist = radius * 2.2;
  const orbit = (cam.orbit * Math.PI) / 180;
  const tilt = (cam.tilt * Math.PI) / 180;
  const eyeY = Math.max(0.02, cam.height) * radius;
  const eye = { x: Math.sin(orbit) * dist, y: eyeY, z: -Math.cos(orbit) * dist };
  const lookY = eyeY - Math.tan(tilt) * dist * 0.45;
  let fx = -eye.x;
  let fy = lookY - eye.y;
  let fz = -eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = fz;
  let ry = 0;
  let rz = -fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;
  const focal = Math.min(w, h) * 1.2;
  const project = (p: V3): P2 | null => {
    const dx = p.x - eye.x;
    const dy = p.y - eye.y;
    const dz = p.z - eye.z;
    const camZ = dx * fx + dy * fy + dz * fz;
    if (camZ < 0.08) return null;
    const camX = dx * rx + dy * ry + dz * rz;
    const camY = dx * ux + dy * uy + dz * uz;
    return { x: w / 2 + (camX / camZ) * focal, y: h / 2 - (camY / camZ) * focal, z: camZ };
  };
  const floorAt = (px: number, py: number): V3 => ({
    x: (px / w - 0.5) * 2,
    y: 0,
    z: (0.5 - py / h) * 2 * aspect,
  });
  const sphereAt = (az: number, alt: number): V3 => {
    const a = (az * Math.PI) / 180;
    const e = (alt * Math.PI) / 180;
    const c = Math.cos(e);
    return { x: radius * c * Math.sin(a), y: radius * Math.sin(e), z: radius * c * Math.cos(a) };
  };
  return { project, floorAt, sphereAt, radius };
}

function paintTri(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  s0: { x: number; y: number },
  s1: { x: number; y: number },
  s2: { x: number; y: number },
  d0: P2,
  d1: P2,
  d2: P2,
) {
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denom) < 1e-4) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denom;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denom;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denom;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denom;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denom;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denom;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function strokeRing(
  ctx: CanvasRenderingContext2D,
  project: (p: V3) => P2 | null,
  sphereAt: (az: number, alt: number) => V3,
  alt: number,
  color: string,
  width: number,
) {
  ctx.beginPath();
  let open = false;
  for (let az = 0; az <= 360; az += 4) {
    const p = project(sphereAt(az, alt));
    if (!p) {
      open = false;
      continue;
    }
    if (!open) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
    open = true;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function paintSkyView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Cam,
  floor: CanvasImageSource | null,
  lines: FloorSeg[],
  dots: SkyDot[],
  arcs: SkyArc[],
  compass: boolean,
  night: number,
) {
  const { project, floorAt, sphereAt, radius } = projector(w, h, cam);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const sky = Math.max(0, Math.min(1, night));
  ctx.fillStyle = sky > 0.5 ? `rgb(${Math.round(7 + (1 - sky) * 40)}, ${Math.round(16 + (1 - sky) * 30)}, ${Math.round(40 + (1 - sky) * 20)})` : `rgb(${Math.round(214 - sky * 120)}, ${Math.round(228 - sky * 140)}, ${Math.round(242 - sky * 80)})`;
  ctx.fillRect(0, 0, w, h);
  for (const alt of [-60, -30]) strokeRing(ctx, project, sphereAt, alt, "rgba(80,100,130,0.35)", 1);
  for (const az of [0, 45, 90, 135]) {
    ctx.beginPath();
    let open = false;
    for (let alt = -80; alt <= 0; alt += 4) {
      const p = project(sphereAt(az, alt));
      if (!p) {
        open = false;
        continue;
      }
      if (!open) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      open = true;
    }
    ctx.strokeStyle = "rgba(80,100,130,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const plane = radius * 1.72;
  const hub = project({ x: 0, y: 0, z: 0 });
  if (hub) {
    const steps = 72;
    for (let i = 0; i < steps; i += 1) {
      const a0 = (i / steps) * Math.PI * 2;
      const a1 = ((i + 1) / steps) * Math.PI * 2;
      const p0 = project({ x: Math.cos(a0) * plane, y: 0, z: Math.sin(a0) * plane });
      const p1 = project({ x: Math.cos(a1) * plane, y: 0, z: Math.sin(a1) * plane });
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.closePath();
      ctx.fillStyle = "rgba(255,252,245,0.06)";
      ctx.fill();
    }
  }
  ctx.beginPath();
  let rim = false;
  for (let deg = 0; deg <= 360; deg += 4) {
    const a = (deg * Math.PI) / 180;
    const p = project({ x: Math.cos(a) * plane, y: 0, z: Math.sin(a) * plane });
    if (!p) {
      rim = false;
      continue;
    }
    if (!rim) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
    rim = true;
  }
  ctx.strokeStyle = "rgba(15,60,90,0.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (floor) {
    const corners = [
      project(floorAt(0, 0)),
      project(floorAt(w, 0)),
      project(floorAt(w, h)),
      project(floorAt(0, h)),
    ];
    if (corners[0] && corners[1] && corners[2] && corners[3]) {
      const [a, b, c, d] = corners as [P2, P2, P2, P2];
      paintTri(ctx, floor, { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, a, b, c);
      paintTri(ctx, floor, { x: 0, y: 0 }, { x: w, y: h }, { x: 0, y: h }, a, c, d);
    }
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const line of lines) {
    const a = project(floorAt(line.x1, line.y1));
    const b = project(floorAt(line.x2, line.y2));
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width;
    ctx.stroke();
  }
  for (const alt of [30, 60]) strokeRing(ctx, project, sphereAt, alt, "rgba(255,252,245,0.35)", 1);
  for (const az of [0, 45, 90, 135]) {
    ctx.beginPath();
    let open = false;
    for (let alt = 0; alt <= 90; alt += 3) {
      const p = project(sphereAt(az, alt));
      if (!p) {
        open = false;
        continue;
      }
      if (!open) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      open = true;
    }
    ctx.strokeStyle = "rgba(255,252,245,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  strokeRing(ctx, project, sphereAt, 0, "rgba(15,60,90,0.95)", 2.5);
  for (const arc of arcs) {
    ctx.beginPath();
    let open = false;
    for (const point of arc.points) {
      const p = project(sphereAt(point.az, point.alt));
      if (!p) {
        open = false;
        continue;
      }
      if (!open) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      open = true;
    }
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  const placed = dots
    .map((dot) => ({ dot, p: project(sphereAt(dot.az, dot.alt)) }))
    .filter((item): item is { dot: SkyDot; p: P2 } => item.p !== null)
    .sort((a, b) => b.p.z - a.p.z);
  ctx.font = "700 14px sans-serif";
  ctx.textBaseline = "middle";
  for (const item of placed) {
    const size = Math.max(3.5, Math.min(16, 420 / item.p.z));
    ctx.globalAlpha = item.dot.dim || item.dot.alt < 0 ? 0.45 : 1;
    ctx.beginPath();
    ctx.arc(item.p.x, item.p.y, size, 0, Math.PI * 2);
    ctx.fillStyle = item.dot.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = item.dot.alt < 0 ? "rgba(255,252,245,0.4)" : "#1c1917";
    ctx.stroke();
    ctx.fillStyle = "#1c1917";
    ctx.textAlign = "left";
    ctx.fillText(item.dot.name, item.p.x + size + 4, item.p.y);
  }
  ctx.globalAlpha = 1;
  if (compass) {
    ctx.font = "700 18px sans-serif";
    ctx.textAlign = "center";
    for (const mark of [
      { az: 0, name: "É" },
      { az: 90, name: "K" },
      { az: 180, name: "D" },
      { az: 270, name: "Ny" },
    ]) {
      const p = project(sphereAt(mark.az, 6));
      if (!p) continue;
      ctx.fillStyle = "rgba(255,252,245,0.9)";
      const width = ctx.measureText(mark.name).width;
      ctx.fillRect(p.x - width / 2 - 6, p.y - 12, width + 12, 24);
      ctx.fillStyle = "#0f3c5a";
      ctx.fillText(mark.name, p.x, p.y);
    }
  }
}
