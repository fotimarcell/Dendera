import * as THREE from "./three.module.min.js";

const views = new WeakMap();

function metrics(w, h) {
  const aspect = h / w;
  const radius = Math.hypot(1, aspect) * 1.12;
  return { aspect, radius, reach: radius * 1.72 };
}
function spherePoint(radius, az, alt) {
  const a = az * Math.PI / 180;
  const e = alt * Math.PI / 180;
  const c = Math.cos(e);
  return new THREE.Vector3(radius * c * Math.sin(a), radius * Math.sin(e), radius * c * Math.cos(a));
}
function floorPoint(px, py, w, h, aspect) {
  return new THREE.Vector3((px / w - 0.5) * 2, 0.02, (0.5 - py / h) * 2 * aspect);
}
function paintColor(input) {
  const color = new THREE.Color("#1c1917");
  try { color.setStyle(input); } catch (error) { color.set("#1c1917"); }
  return color;
}
function disposeNode(node) {
  node.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const material = child.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    list.forEach((item) => {
      if (item.map) item.map.dispose();
      item.dispose();
    });
  });
}
function makeLabel(text) {
  const board = document.createElement("canvas");
  board.width = 256;
  board.height = 64;
  const ctx = board.getContext("2d");
  if (!ctx) return null;
  ctx.font = "700 28px sans-serif";
  ctx.fillStyle = "#1c1917";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, 32);
  const texture = new THREE.CanvasTexture(board);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(0.42, 0.105, 1);
  sprite.center.set(0, 0.5);
  return sprite;
}
function buildStatic(view, w, h) {
  const { aspect, radius, reach } = metrics(w, h);
  disposeNode(view.staticGroup);
  view.staticGroup.clear();
  view.aspect = aspect;
  const upper = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe7e5e4, wireframe: true, transparent: true, opacity: 0.55 }),
  );
  const lower = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 36, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xa8a29e, wireframe: true, transparent: true, opacity: 0.28 }),
  );
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(reach, 72),
    new THREE.MeshBasicMaterial({ color: 0xfffcf5, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
  );
  disk.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(reach * 0.985, reach, 72),
    new THREE.MeshBasicMaterial({ color: 0x0f3c5a, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  rim.rotation.x = Math.PI / 2;
  const equator = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.992, radius * 1.008, 96),
    new THREE.MeshBasicMaterial({ color: 0x0f3c5a, side: THREE.DoubleSide }),
  );
  equator.rotation.x = Math.PI / 2;
  equator.position.y = 0.004;
  view.staticGroup.add(upper, lower, disk, rim, equator);
  const floorGeo = new THREE.PlaneGeometry(2, aspect * 2);
  floorGeo.rotateX(Math.PI / 2);
  view.floor.geometry.dispose();
  view.floor.geometry = floorGeo;
  view.floor.position.y = 0.012;
}
function ensure(canvas) {
  const found = views.get(canvas);
  if (found) return found;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  const staticGroup = new THREE.Group();
  const moving = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0xf5f5f4, side: THREE.DoubleSide }));
  scene.add(staticGroup, floor, moving);
  const view = { renderer, scene, camera, staticGroup, moving, floor, texture: null, aspect: -1 };
  views.set(canvas, view);
  return view;
}
function placeCamera(camera, cam, w, h) {
  const { radius } = metrics(w, h);
  const dist = radius * 2.2;
  const orbit = cam.orbit * Math.PI / 180;
  const tilt = cam.tilt * Math.PI / 180;
  const eyeY = Math.max(0.02, cam.height) * radius;
  camera.aspect = w / h;
  camera.position.set(Math.sin(orbit) * dist, eyeY, -Math.cos(orbit) * dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, eyeY - Math.tan(tilt) * dist * 0.45, 0);
  camera.updateProjectionMatrix();
}
function render(canvas, w, h, cam, floor, lines, dots, arcs, compass, night) {
  const view = ensure(canvas);
  const { aspect, radius } = metrics(w, h);
  if (Math.abs(view.aspect - aspect) > 0.001) buildStatic(view, w, h);
  const sky = Math.max(0, Math.min(1, night));
  view.scene.background = new THREE.Color(sky > 0.5 ? 0x102038 : 0xd6e4f2);
  view.renderer.setSize(w, h, false);
  placeCamera(view.camera, cam, w, h);
  const material = view.floor.material;
  if (floor) {
    if (!view.texture) {
      view.texture = new THREE.CanvasTexture(floor);
      view.texture.colorSpace = THREE.SRGBColorSpace;
      material.map = view.texture;
    } else if (view.texture.image !== floor) view.texture.image = floor;
    view.texture.needsUpdate = true;
    material.color.set("#ffffff");
  } else {
    material.map = null;
    material.color.set("#f5f5f4");
  }
  material.needsUpdate = true;
  view.floor.visible = true;
  disposeNode(view.moving);
  view.moving.clear();
  if (lines.length) {
    const positions = [];
    const colors = [];
    lines.forEach((line) => {
      const a = floorPoint(line.x1, line.y1, w, h, aspect);
      const b = floorPoint(line.x2, line.y2, w, h, aspect);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const color = paintColor(line.color);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    view.moving.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));
  }
  arcs.forEach((arc) => {
    let previous = null;
    let current = [];
    const chunks = [];
    arc.points.forEach((point) => {
      const next = spherePoint(radius, point.az, point.alt);
      if (previous && previous.distanceTo(next) > radius * 0.45) {
        if (current.length > 3) chunks.push(current);
        current = [];
      }
      current.push(next.x, next.y, next.z);
      previous = next;
    });
    if (current.length > 3) chunks.push(current);
    const color = paintColor(arc.color);
    chunks.forEach((chunk) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(chunk, 3));
      view.moving.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
    });
  });
  dots.forEach((dot) => {
    const at = spherePoint(radius, dot.az, dot.alt);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(dot.dim || dot.alt < 0 ? radius * 0.012 : radius * 0.02, 12, 8),
      new THREE.MeshBasicMaterial({ color: paintColor(dot.color), transparent: true, opacity: dot.dim || dot.alt < 0 ? 0.45 : 1 }),
    );
    marker.position.copy(at);
    view.moving.add(marker);
    const label = makeLabel(dot.name);
    if (label) {
      label.position.copy(at).add(new THREE.Vector3(radius * 0.03, radius * 0.02, 0));
      view.moving.add(label);
    }
  });
  if (compass) {
    [{ az: 0, name: "É" }, { az: 90, name: "K" }, { az: 180, name: "D" }, { az: 270, name: "Ny" }].forEach((mark) => {
      const label = makeLabel(mark.name);
      if (!label) return;
      label.position.copy(spherePoint(radius * 1.04, mark.az, 4));
      view.moving.add(label);
    });
  }
  view.renderer.render(view.scene, view.camera);
}
window.SkyGL = { render };
