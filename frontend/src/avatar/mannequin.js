// My Mannequin, step 2: the 3D mannequin and its viewer.
//
// A figure built to the person's own measurements (measure.js): the torso
// follows the outline read from their photos, level by level; arms and legs
// are as long and as thick as theirs; the head carries their face. Sizes are
// in centimetres, standing on the floor at y = 0, facing +z.
//
// It is a mannequin, not a scan: smooth shapes of the right sizes, with a
// photo of the face on the front of the head.

import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, DoubleSide,
  Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Quaternion, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const AROUND = 64;
const BODY_COLOUR = "#e6e1ec";
const UP = new Vector3(0, 1, 0);
// The pose finder's shoulder joints are inside the body's outer width
export const SHOULDER_BREADTH = 1.18;
// Arms held a little away from the body, so sleeves and sides can be seen
const ARM_ANGLE = (16 * Math.PI) / 180;

// Where everything is on this person's mannequin, worked out once and
// shared with the garment (dress.js) so clothes sit on the same body.
export const layoutOf = (measurements, profile, section) => {
  const m = measurements;
  const H = m.height;
  const head = { rx: H * 0.045, ry: H * 0.066, rz: H * 0.054 };
  head.y = H - head.ry;
  // Heights come from the photo's joints, which can sit a little high or low
  // (heels, hair, a tilted camera). They are held to where shoulders and
  // hips are on a body of this height, so the neck and legs keep their shape.
  const hipJointY = Math.min(H * 0.56, Math.max(H * 0.48, m.hipJointHeight));
  const shoulderY = Math.min(H * 0.84, Math.max(H * 0.81, hipJointY + m.torso));
  const torso = shoulderY - hipJointY;
  const crotchY = Math.min(Math.max(m.inseam, H * 0.42), hipJointY - 4);
  // The neck meets the shoulders just under the chin, never a long stalk
  const neckY = Math.max(shoulderY + H * 0.025, H - head.ry * 2 - H * 0.03);

  // The torso, top to bottom: one ellipse per level of the photo outline,
  // evened out with the levels next to it so the figure has no steps
  const even = (index, key) => {
    const before = profile[Math.max(0, index - 1)][key];
    const after = profile[Math.min(profile.length - 1, index + 1)][key];
    return (before + profile[index][key] * 2 + after) / 4;
  };
  const rings = profile.map((entry, index) => ({
    level: entry.level,
    y: shoulderY - entry.level * torso,
    rx: even(index, "halfWidth"),
    rz: even(index, "halfDepth"),
    // A fuller chest sits forward of the spine
    cz: section === "women" && entry.level > 0.15 && entry.level < 0.45 ? entry.halfDepth * 0.14 : 0,
  }));
  const at = (level) => rings.reduce((best, ring) => (Math.abs(ring.level - level) < Math.abs(best.level - level) ? ring : best));
  const hipRing = at(1.06);

  const shoulderHalf = m.shoulder / 2;
  const arm = (sign) => {
    const direction = new Vector3(sign * Math.sin(ARM_ANGLE), -Math.cos(ARM_ANGLE), 0);
    // A little inside and below the shoulder's corner, so the round top of
    // the arm stays under a garment's shoulder
    const shoulder = new Vector3(sign * (shoulderHalf - H * 0.03), shoulderY - H * 0.032, 0);
    // An arm bent or turned in the photo measures short: never shorter than arms are
    const length = Math.max(m.arm, H * 0.31);
    const elbow = shoulder.clone().addScaledVector(direction, length * 0.48);
    const wrist = elbow.clone().addScaledVector(direction, length * 0.52);
    return { sign, direction, shoulder, elbow, wrist, radii: [H * 0.03, H * 0.024, H * 0.017] };
  };
  const leg = (sign) => {
    const x = sign * hipRing.rx * 0.52;
    const kneeY = crotchY * 0.53;
    const ankleY = H * 0.045;
    // Loose trousers in the photo measure wider than the leg inside them:
    // held to what a leg can be, tapering from thigh to ankle
    const thigh = Math.min(m.thigh / 2, H * 0.055, hipRing.rx * 0.46);
    const knee = thigh * 0.68;
    const calf = Math.min(m.calf / 2, knee * 0.95);
    return {
      sign, x, kneeY, ankleY, topY: crotchY + torso * 0.1,
      radii: { thigh, knee, calf, ankle: calf * 0.62 },
    };
  };

  return {
    H, section, shoulderY, hipJointY, torso, crotchY, neckY, head, rings, at,
    neckRadius: H * (section === "women" ? 0.03 : 0.033),
    // The joints the product photo's body points line up with
    shoulderJointHalf: shoulderHalf / SHOULDER_BREADTH,
    hipJointHalf: hipRing.rx * 0.55,
    arms: { left: arm(1), right: arm(-1) },
    legs: { left: leg(1), right: leg(-1) },
  };
};

// A surface through a stack of ellipses (each { y, rx, rz, cx?, cz? }),
// closed at the ends when asked
export const stackGeometry = (rings, { capTop = false, capBottom = false } = {}) => {
  const position = [];
  const index = [];
  rings.forEach((ring) => {
    for (let i = 0; i < AROUND; i += 1) {
      const angle = (i / AROUND) * Math.PI * 2;
      position.push((ring.cx || 0) + ring.rx * Math.sin(angle), ring.y, (ring.cz || 0) + ring.rz * Math.cos(angle));
    }
  });
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let i = 0; i < AROUND; i += 1) {
      const a = r * AROUND + i;
      const b = r * AROUND + ((i + 1) % AROUND);
      index.push(a, a + AROUND, b, b, a + AROUND, b + AROUND);
    }
  }
  const cap = (ringIndex, flip) => {
    const ring = rings[ringIndex];
    const centre = position.length / 3;
    position.push(ring.cx || 0, ring.y, ring.cz || 0);
    for (let i = 0; i < AROUND; i += 1) {
      const a = ringIndex * AROUND + i;
      const b = ringIndex * AROUND + ((i + 1) % AROUND);
      index.push(...(flip ? [centre, b, a] : [centre, a, b]));
    }
  };
  if (capTop) cap(0, false);
  if (capBottom) cap(rings.length - 1, true);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

// A rounded limb between two points, with a different radius at each end
const limb = (from, to, radiusFrom, radiusTo, material) => {
  const along = to.clone().sub(from);
  const length = along.length();
  const group = new Group();
  const shaft = new Mesh(new CylinderGeometry(radiusFrom, radiusTo, length, 36), material);
  shaft.position.copy(from).addScaledVector(along, 0.5);
  // A cylinder's top is at +y: point it back at where the limb starts
  shaft.quaternion.copy(new Quaternion().setFromUnitVectors(UP, along.clone().negate().normalize()));
  // Rounded at both ends, so the joints (elbow, wrist) are smooth
  const start = new Mesh(new SphereGeometry(radiusFrom, 28, 20), material);
  start.position.copy(from);
  const end = new Mesh(new SphereGeometry(radiusTo, 28, 20), material);
  end.position.copy(to);
  group.add(shaft, start, end);
  return group;
};

// The head's picture: the person's face, sharp across the whole face and
// fading into their skin colour only at its very edge (so no square shows
// and the ears and neck match)
const FACE_SIZE = 512;
const headTexture = (face) => {
  const canvas = document.createElement("canvas");
  canvas.width = FACE_SIZE;
  canvas.height = FACE_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = face.skin;
  context.fillRect(0, 0, FACE_SIZE, FACE_SIZE);

  const masked = document.createElement("canvas");
  masked.width = FACE_SIZE;
  masked.height = FACE_SIZE;
  const maskedContext = masked.getContext("2d");
  maskedContext.drawImage(face.canvas, 0, 0);
  maskedContext.globalCompositeOperation = "destination-in";
  // An oval the shape of this face, a little past the cheeks and the chin
  maskedContext.translate(FACE_SIZE / 2, FACE_SIZE / 2);
  maskedContext.scale((face.cheekShare * FACE_SIZE) / 2 * 1.02, (face.lengthShare * FACE_SIZE) / 2 * 1.12);
  const fade = maskedContext.createRadialGradient(0, 0, 0.84, 0, 0, 1);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  maskedContext.fillStyle = fade;
  maskedContext.fillRect(-2, -2, 4, 4);
  context.drawImage(masked, 0, 0);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
};

// How wide a head is compared with the face across the cheeks, and where the
// chin is on the head (as a share of its half-height, below its middle)
const HEAD_TO_CHEEKS = 1.08;
const CHIN = 0.96;
// Forehead-to-chin as a share of the head's half-height, and how far up from
// the chin the tip of the nose is
const FACE_ON_HEAD = 1.62;
const NOSE_UP = 0.37;

// The head: a full skull above, a jaw that stays wide down to the chin, a
// nose, and the face placed on its front so the chin is on the chin and the
// cheeks span the head. Hair covers the top and back, from the hairline.
const buildHead = (head, face, bodyMaterial) => {
  const group = new Group();
  const geometry = new SphereGeometry(1, 72, 56);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  // Centimetres per picture pixel: the cheeks in the picture span the head's width
  const scale = face ? (2 * head.rx) / HEAD_TO_CHEEKS / (face.cheekShare * FACE_SIZE) : 1;
  const faceLength = face ? face.lengthShare * FACE_SIZE * scale : 0;
  // A longer face has a taller head, so the forehead stays on its front
  const ry = face ? Math.min(head.ry * 1.1, Math.max(head.ry * 0.94, faceLength / FACE_ON_HEAD)) : head.ry;
  const headY = head.y + head.ry - ry;
  const chinPixel = face ? FACE_SIZE / 2 + (face.lengthShare * FACE_SIZE) / 2 : 0;
  const foreheadTop = face ? faceLength / ry - CHIN : 0.66;
  const noseY = face ? (NOSE_UP * faceLength) / ry - CHIN : -0.36;
  // The face's oval in the picture (headTexture), in pixels
  const ovalX = face ? (face.cheekShare * FACE_SIZE) / 2 * 1.02 : 1;
  const ovalY = face ? (face.lengthShare * FACE_SIZE) / 2 * 1.12 : 1;
  const round = [];

  for (let i = 0; i < positions.count; i += 1) {
    const ox = positions.getX(i);
    const y = positions.getY(i);
    const oz = positions.getZ(i);
    round.push(ox, y, oz);
    // Fuller than a ball: the width holds down to the jaw before turning in to the chin
    const power = y < 0 ? 2.7 : 2.2;
    const ring = Math.hypot(ox, oz);
    const fuller = ring > 1e-6 ? (1 - Math.abs(y) ** power) ** (1 / power) / ring : 0;
    const jaw = y < 0 ? (-y) ** 1.6 : 0;
    const x = ox * fuller * (1 - 0.2 * jaw);
    let z = oz * fuller;
    // The back of the skull is fuller, and tucks in to the neck below
    z *= z > 0 ? 1 - 0.06 * jaw : 1.08 * (1 - 0.24 * jaw);
    if (z > 0) {
      const up = (y - noseY) / (y > noseY ? 0.3 : 0.1);
      z += 0.1 * Math.exp(-((x / 0.17) ** 2) - up ** 2);
    }
    positions.setXYZ(i, x, y, z);
    if (face) {
      let pixelX = FACE_SIZE / 2 + (x * head.rx) / scale;
      let pixelY = chinPixel - ((y + CHIN) * ry) / scale;
      if (oz <= 0.02) {
        // The back and sides are plain skin: just outside the face's oval
        const dx = pixelX - FACE_SIZE / 2;
        const dy = pixelY - FACE_SIZE / 2;
        const inside = Math.hypot(dx / ovalX, dy / ovalY);
        if (inside < 1.06) {
          const out = inside > 1e-6 ? 1.06 / inside : 0;
          pixelX = FACE_SIZE / 2 + (inside > 1e-6 ? dx * out : ovalX * 1.06);
          pixelY = FACE_SIZE / 2 + dy * out;
        }
      }
      uv.setXY(i, pixelX / FACE_SIZE, 1 - pixelY / FACE_SIZE);
    }
  }
  geometry.computeVertexNormals();

  const material = face
    ? new MeshStandardMaterial({ map: headTexture(face), roughness: 0.62, metalness: 0 })
    : bodyMaterial;
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(head.rx, ry, head.rz);
  mesh.position.y = headY;
  group.add(mesh);

  if (face) {
    // Hair: the same shape as the head, a little larger, kept only above the
    // hairline: over the forehead's top at the front, down to the ears at the
    // sides and to the nape at the back. Its colour is the person's; its
    // style is not.
    const hairline = Math.min(0.8, Math.max(0.5, foreheadTop - 0.03));
    const isHair = (index) => {
      const y = round[index * 3 + 1];
      const z = round[index * 3 + 2];
      const back = Math.min(1, Math.max(0, (0.25 - z) / 0.6)) ** 0.8;
      return y > hairline + (-0.72 - hairline) * back;
    };
    const all = geometry.index.array;
    const kept = [];
    for (let offset = 0; offset < all.length; offset += 3) {
      if (isHair(all[offset]) && isHair(all[offset + 1]) && isHair(all[offset + 2])) {
        kept.push(all[offset], all[offset + 1], all[offset + 2]);
      }
    }
    const hairGeometry = new BufferGeometry();
    hairGeometry.setAttribute("position", new Float32BufferAttribute(Float32Array.from(positions.array), 3));
    hairGeometry.setIndex(kept);
    hairGeometry.computeVertexNormals();
    const hair = new Mesh(
      hairGeometry,
      new MeshStandardMaterial({ color: new Color(face.hair), roughness: 0.8, metalness: 0, side: DoubleSide })
    );
    hair.scale.set(head.rx * 1.07, ry * 1.06, head.rz * 1.08);
    hair.position.y = headY;
    group.add(hair);
  }
  return group;
};

// The mannequin for one person. `face`: from face.js, or null.
export const buildMannequin = (layout, face) => {
  const group = new Group();
  group.name = "Mannequin";
  // With a face, the whole figure is the person's own skin colour, so the
  // head, neck and body are one; without one, a plain shop mannequin
  const material = face
    ? new MeshPhysicalMaterial({ color: new Color(face.skin), roughness: 0.6, metalness: 0, sheen: 0.4, sheenRoughness: 0.6 })
    : new MeshPhysicalMaterial({ color: new Color(BODY_COLOUR), roughness: 0.5, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4 });
  const { H, neckRadius, neckY, head } = layout;
  const rings = layout.rings;

  // Torso: neck, the slope of the shoulders, then the measured outline,
  // running into the tops of the legs
  const first = rings[0];
  const last = rings.at(-1);
  const leg = layout.legs.left;
  const acrossLegs = leg.x + leg.radii.thigh;
  group.add(new Mesh(stackGeometry([
    { y: neckY + H * 0.02, rx: neckRadius, rz: neckRadius },
    { y: neckY, rx: neckRadius * 1.15, rz: neckRadius * 1.1 },
    { y: first.y + H * 0.016, rx: first.rx * 0.78, rz: first.rz * 0.82 },
    ...rings,
    { y: (last.y + layout.crotchY) / 2, rx: (last.rx + acrossLegs) / 2, rz: (last.rz + leg.radii.thigh * 1.08) / 2 },
    { y: layout.crotchY, rx: acrossLegs, rz: leg.radii.thigh * 1.08 },
  ], { capTop: true, capBottom: true }), material));

  // Neck up into the head
  const neckTop = head.y - head.ry * 0.4;
  group.add(new Mesh(new CylinderGeometry(neckRadius * 0.9, neckRadius * 1.04, neckTop - neckY, 32), material)
    .translateY((neckTop + neckY) / 2));
  group.add(buildHead(head, face, material));

  for (const arm of Object.values(layout.arms)) {
    group.add(limb(arm.shoulder, arm.elbow, arm.radii[0], arm.radii[1], material));
    group.add(limb(arm.elbow, arm.wrist, arm.radii[1], arm.radii[2], material));
    const hand = new Mesh(new SphereGeometry(1, 24, 16), material);
    hand.scale.set(arm.radii[2] * 1.25, H * 0.05, arm.radii[2] * 0.75);
    hand.position.copy(arm.wrist).addScaledVector(arm.direction, H * 0.045);
    hand.quaternion.copy(new Quaternion().setFromUnitVectors(UP, arm.direction.clone().negate()));
    group.add(hand);
  }

  for (const leg of Object.values(layout.legs)) {
    const r = leg.radii;
    group.add(new Mesh(stackGeometry([
      // Starts inside the torso, a little narrower, so no edge shows at the hip
      { y: leg.topY, cx: leg.x, rx: r.thigh * 0.86, rz: r.thigh * 0.9 },
      { y: layout.crotchY, cx: leg.x, rx: r.thigh, rz: r.thigh * 1.05 },
      { y: (leg.topY + leg.kneeY) / 2, cx: leg.x, rx: r.thigh * 0.88, rz: r.thigh * 0.92 },
      { y: leg.kneeY, cx: leg.x, rx: r.knee, rz: r.knee },
      { y: leg.kneeY * 0.68, cx: leg.x, rx: r.calf, rz: r.calf, cz: -r.calf * 0.15 },
      { y: leg.ankleY, cx: leg.x, rx: r.ankle, rz: r.ankle },
    ], { capTop: true, capBottom: true }), material));
    const foot = new Mesh(new SphereGeometry(1, 16, 10), material);
    foot.scale.set(r.ankle * 1.25, H * 0.022, H * 0.075);
    foot.position.set(leg.x, H * 0.022, H * 0.035);
    group.add(foot);
  }
  return group;
};

// A viewer the person can turn with a finger or the mouse.
// Returns { setMannequin, setGarment, dispose }.
export const createViewer = (canvas) => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  // Studio rendering: soft light from all round (so shapes read as round,
  // not flat), film-like tones, and a soft shadow on the floor
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 10, 3000);
  const environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(80, 420, 190);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -140;
  key.shadow.camera.right = 140;
  key.shadow.camera.top = 240;
  key.shadow.camera.bottom = -40;
  key.shadow.camera.near = 50;
  key.shadow.camera.far = 900;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0015;
  scene.add(key);
  const fill = new DirectionalLight(0xfff1e0, 0.5);
  fill.position.set(-220, 140, -240);
  scene.add(fill);
  // The floor: nothing but the shadow that falls on it
  const floor = new Mesh(new PlaneGeometry(900, 900), new ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minPolarAngle = Math.PI * 0.25;
  controls.maxPolarAngle = Math.PI * 0.6;
  // Turns slowly by itself until the person takes over
  controls.autoRotate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 1.6;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  let mannequin = null;
  let garment = null;
  let running = true;

  const frameFor = (height) => {
    controls.target.set(0, height * 0.52, 0);
    camera.position.set(0, height * 0.58, height * 2.35);
    controls.minDistance = height * 1.1;
    controls.maxDistance = height * 3.2;
    controls.update();
  };

  const resize = () => {
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 400;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  };

  const loop = () => {
    if (!running) return;
    resize();
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const swap = (old, next) => {
    if (old) {
      scene.remove(old);
      old.traverse((node) => {
        node.geometry?.dispose();
        for (const material of [node.material].flat()) {
          material?.map?.dispose();
          material?.dispose();
        }
      });
    }
    if (next) {
      next.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          for (const material of [node.material].flat()) {
            if (material.map) material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
        }
      });
      scene.add(next);
    }
    return next;
  };

  let figure = { height: 170, headY: 158 };
  return {
    setMannequin(object, height, headY) {
      const first = !mannequin;
      mannequin = swap(mannequin, object);
      figure = { height, headY: headY ?? height * 0.93 };
      // A rebuilt mannequin (a new face, a corrected measurement) keeps the view the person chose
      if (object && first) frameFor(height);
    },
    // Close on the face, or back to the whole figure
    focus(part) {
      controls.autoRotate = false;
      if (part === "face") {
        controls.minDistance = figure.height * 0.3;
        controls.target.set(0, figure.headY, 0);
        camera.position.set(0, figure.headY, figure.height * 0.62);
        controls.update();
      } else {
        frameFor(figure.height);
      }
    },
    setGarment(object) {
      garment = swap(garment, object);
    },
    // Turn to a side: 0 front, 90 the person's left, 180 back
    turnTo(degrees) {
      controls.autoRotate = false;
      const distance = camera.position.distanceTo(controls.target);
      const angle = (degrees * Math.PI) / 180;
      camera.position.set(controls.target.x + Math.sin(angle) * distance, camera.position.y, controls.target.z + Math.cos(angle) * distance);
      controls.update();
    },
    dispose() {
      running = false;
      swap(mannequin, null);
      swap(garment, null);
      controls.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
};
