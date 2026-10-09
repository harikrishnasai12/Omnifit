// Live Try-On audit (a developer tool; nothing in the app imports it).
//
// Answers "how much of the catalogue can be tried on?" by running one product
// through the real pipeline: the cut-out (tryon/garment.js), then the drawing
// (tryon/engine.js) on a stand-in customer, facing the camera and turned.
// The stand-in is a fixed set of body points, so every product is judged on
// the same body and no photo of a person is needed.
//
// Used by tests/e2e/tryon_audit.mjs, which loads this file from the dev server.

import { drawTryOn } from "./engine";
import { cutGarment } from "./garment";

const FRAME = { width: 480, height: 800 };
const TURN_DEGREES = 40;
// Less of the frame drawn than this means nothing recognisable is on the person
const MIN_DRAWN = 0.015;

// A person facing the camera (their left is on the right of the picture), in frame pixels
const STANDING = {
  leftEye: { x: 262, y: 112 }, rightEye: { x: 218, y: 112 },
  leftShoulder: { x: 310, y: 200 }, rightShoulder: { x: 170, y: 200 },
  leftElbow: { x: 335, y: 300 }, rightElbow: { x: 145, y: 300 },
  leftWrist: { x: 345, y: 395 }, rightWrist: { x: 135, y: 395 },
  leftHip: { x: 285, y: 400 }, rightHip: { x: 195, y: 400 },
  leftKnee: { x: 282, y: 560 }, rightKnee: { x: 198, y: 560 },
  leftAnkle: { x: 280, y: 710 }, rightAnkle: { x: 200, y: 710 },
};

// The same person turned about their own vertical axis
const turned = (degrees) => {
  const angle = (degrees * Math.PI) / 180;
  const centre = FRAME.width / 2;
  return Object.fromEntries(
    Object.entries(STANDING).map(([name, point]) => [
      name,
      { x: centre + (point.x - centre) * Math.cos(angle), y: point.y, z: -(point.x - centre) * Math.sin(angle) },
    ])
  );
};

const drawStandIn = (ctx, body) => {
  ctx.fillStyle = "#ece9f2";
  ctx.fillRect(0, 0, FRAME.width, FRAME.height);
  ctx.strokeStyle = "#b9b3c9";
  ctx.lineCap = "round";
  const bone = (a, b, width) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(body[a].x, body[a].y);
    ctx.lineTo(body[b].x, body[b].y);
    ctx.stroke();
  };
  for (const side of ["left", "right"]) {
    bone(`${side}Shoulder`, `${side}Elbow`, 30);
    bone(`${side}Elbow`, `${side}Wrist`, 24);
    bone(`${side}Hip`, `${side}Knee`, 46);
    bone(`${side}Knee`, `${side}Ankle`, 36);
  }
  ctx.fillStyle = "#b9b3c9";
  ctx.beginPath();
  ctx.moveTo(body.leftShoulder.x + 14, body.leftShoulder.y - 14);
  ctx.lineTo(body.rightShoulder.x - 14, body.rightShoulder.y - 14);
  ctx.lineTo(body.rightHip.x - 18, body.rightHip.y + 20);
  ctx.lineTo(body.leftHip.x + 18, body.leftHip.y + 20);
  ctx.closePath();
  ctx.fill();
  const eyes = { x: (body.leftEye.x + body.rightEye.x) / 2, y: body.leftEye.y };
  ctx.beginPath();
  ctx.ellipse(eyes.x, eyes.y + 12, 40, 52, 0, 0, Math.PI * 2);
  ctx.fill();
};

// The garment drawn on the stand-in: the picture, and how much of the frame it covers
const wear = (cut, garment, body) => {
  const overlay = document.createElement("canvas");
  overlay.width = FRAME.width;
  overlay.height = FRAME.height;
  const overlayContext = overlay.getContext("2d", { willReadFrequently: true });
  const layer = document.createElement("canvas");
  layer.width = FRAME.width;
  layer.height = FRAME.height;
  drawTryOn(overlayContext, layer.getContext("2d"), cut, garment, body);

  const alpha = overlayContext.getImageData(0, 0, FRAME.width, FRAME.height).data;
  let drawn = 0;
  let sumX = 0;
  let sumY = 0;
  for (let offset = 3; offset < alpha.length; offset += 4) {
    if (alpha[offset] > 32) {
      const pixel = (offset - 3) / 4;
      drawn += 1;
      sumX += pixel % FRAME.width;
      sumY += Math.floor(pixel / FRAME.width);
    }
  }

  const picture = document.createElement("canvas");
  picture.width = FRAME.width;
  picture.height = FRAME.height;
  const pictureContext = picture.getContext("2d");
  drawStandIn(pictureContext, body);
  pictureContext.drawImage(overlay, 0, 0);
  return {
    drawn: drawn / (FRAME.width * FRAME.height),
    // The middle of everything drawn
    centre: drawn ? { x: sumX / drawn, y: sumY / drawn } : null,
    picture: picture.toDataURL("image/jpeg", 0.8),
  };
};

const thumbnail = (canvas, side = 260) => {
  const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * scale));
  small.height = Math.max(1, Math.round(canvas.height * scale));
  small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL("image/png");
};

const LEGGED = /trouser|pant|jean|jogger|legging|short|chino|cargo|jumpsuit|tracksuit|palazzo/;
const DRAPED = /saree|sari|lehenga|dupatta|gown|shawl/;

// Runs one product through the try-on. `garment` is what /api/tryon/garment
// returned for it. Returns
// { verdict: "pass" | "partial" | "fail", reasons, source, anchors, ms, cut, front, side }
export const auditGarment = async (photoUrl, garment) => {
  const started = performance.now();
  let cut;
  try {
    cut = await cutGarment(photoUrl, garment);
  } catch (error) {
    return { verdict: "fail", reasons: [error.message || "The cut-out step failed"], ms: Math.round(performance.now() - started) };
  }
  const ms = Math.round(performance.now() - started);
  if (!cut.ok) {
    return { verdict: "fail", reasons: [cut.message], ms };
  }

  const front = wear(cut, garment, turned(0));
  const side = wear(cut, garment, turned(TURN_DEGREES));
  const anchors = Object.keys(cut.anchors);
  const has = (...names) => names.every((name) => cut.anchors[name]);
  const accessory = garment.region === "head" || garment.region === "face";
  const sleeved = !accessory && garment.region !== "lower" && garment.sleeves !== "none" && garment.sleeves !== "sleeveless";

  const reasons = [];
  let verdict = "pass";
  const partial = (reason) => {
    reasons.push(reason);
    if (verdict === "pass") verdict = "partial";
  };

  if (front.drawn < MIN_DRAWN) {
    verdict = "fail";
    reasons.push("Nothing was drawn on the person: the body points it needs weren't found in the photo");
  } else {
    if (garment.view !== "front") partial(`The photo shows the ${garment.view} of the garment, drawn as if it were the front`);
    if (cut.source === "flat" && !accessory) partial("Placed by its outline, as one flat piece: sleeves and legs don't move separately and it doesn't turn");
    if (accessory) {
      // A hat sits above the eyes and eyewear on them, centred on the face
      const eyes = { x: (STANDING.leftEye.x + STANDING.rightEye.x) / 2, y: STANDING.leftEye.y };
      const apart = STANDING.leftEye.x - STANDING.rightEye.x;
      const offCentre = Math.abs(front.centre.x - eyes.x) > apart * 0.5;
      const wrongHeight = garment.region === "head" ? front.centre.y > eyes.y : Math.abs(front.centre.y - eyes.y) > apart * 0.6;
      if (offCentre || wrongHeight) partial("Sits off the head: the photo isn't a plain, straight-on shot of the item");
    }
    if (DRAPED.test((garment.garment || "").toLowerCase())) partial("Loose draped fabric is drawn as a stiff piece: no drape or flow");
    if (cut.source === "model" && sleeved && !(has("leftElbow") && has("rightElbow"))) partial("A sleeve is missing: an elbow wasn't found in the photo");
    if (cut.source === "model" && garment.region !== "upper" && !accessory && !has("leftHip", "rightHip")) partial("The lower half isn't drawn: the hips weren't found in the photo");
    if (cut.source === "model" && garment.region === "lower" && LEGGED.test((garment.garment || "").toLowerCase()) && !has("leftKnee", "rightKnee")) {
      partial("Drawn as one hanging piece: the knees weren't found in the photo");
    }
    if (cut.source === "model" && side.drawn < front.drawn * 0.35) partial("Mostly disappears when the person turns");
  }

  return {
    verdict, reasons, source: cut.source, anchors, ms,
    drawn: { front: Number(front.drawn.toFixed(3)), side: Number(side.drawn.toFixed(3)) },
    cut: thumbnail(cut.canvas), front: front.picture, side: side.picture,
  };
};
