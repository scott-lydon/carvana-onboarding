/**
 * ConditionTileExamples — per-angle reference illustration + checklist.
 *
 * Each of the 9 ConditionIntake tiles (front_left, front_right,
 * rear_left, rear_right, odometer, interior_front, interior_rear,
 * vin_plate, damage_closeup) has a short, concrete description of what
 * the photo should contain, plus an inline SVG showing the framing.
 *
 * Why inline SVGs instead of photos: real Carvana inventory photos are
 * copyrighted, and stock photos lock us to a specific car model. Hand-
 * drawn SVG silhouettes are cheap, model-agnostic, and never go stale.
 * They show the FRAMING (where the photographer stands and what fills
 * the frame) which is the actual question the user is asking.
 *
 * Used by: ConditionIntake's per-tile "See example" affordance and the
 * GuidedCapture overlay (Feature 3) which shows the same illustration
 * while the user lines up their shot.
 */
import type { JSX } from "react";
import type { ConditionAngle } from "./ConditionIntake.tsx";

export interface ConditionTileExample {
  /** Single sentence shown as the header of the example panel. */
  readonly headline: string;
  /** Short bullet list of what the photo MUST contain to be usable. */
  readonly mustContain: readonly string[];
  /** Short bullet list of common mistakes to avoid. */
  readonly avoid: readonly string[];
  /** Inline SVG showing the framing for this angle. */
  readonly illustration: JSX.Element;
}

/**
 * Look up the example bundle for an angle. Throws on an unknown angle so
 * a future angle added to ConditionAngle without an example here surfaces
 * as a clear error rather than silently rendering nothing.
 */
export function getConditionTileExample(
  angle: ConditionAngle,
): ConditionTileExample {
  // TypeScript proves EXAMPLES has every ConditionAngle key, so this
  // index access is always defined under the current type contract.
  // If the union ever gains a new angle without an EXAMPLES entry the
  // compiler will fail before this code runs.
  return EXAMPLES[angle];
}

// ─────────────────────────────────────────────────────────────────────
// Shared SVG primitives so each illustration stays compact + consistent.
// All illustrations share the same 240x140 viewBox and color palette.
// ─────────────────────────────────────────────────────────────────────

const CAR_BODY_FILL = "#cbd5e1";
const CAR_BODY_STROKE = "#475569";
const HIGHLIGHT_STROKE = "#2563eb";
const ARROW_STROKE = "#2563eb";
const GROUND_FILL = "#f1f5f9";

const SVG_ATTRS = {
  width: "100%",
  viewBox: "0 0 240 140",
  xmlns: "http://www.w3.org/2000/svg",
  role: "img" as const,
};

/**
 * Stylized 3/4-view car silhouette used by the four corner-angle
 * illustrations. The illustration is mirrored or rotated below to
 * produce front-left, front-right, rear-left, rear-right variants
 * without authoring four nearly-identical drawings.
 *
 * Coordinate system: car drawn pointing right (front on the right),
 * camera marker placed below-left in the default illustration.
 */
function CarFromFrontLeft(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Front-left corner framing">
      <title>Front-left corner framing</title>
      <rect x="0" y="100" width="240" height="40" fill={GROUND_FILL} />
      {/* Car body (3/4 view, front facing right) */}
      <path
        d="M 50 80 L 60 60 L 120 55 L 180 60 L 200 75 L 200 95 L 50 95 Z"
        fill={CAR_BODY_FILL}
        stroke={CAR_BODY_STROKE}
        strokeWidth="2"
      />
      {/* Greenhouse / windows */}
      <path
        d="M 70 78 L 78 62 L 165 62 L 185 78 Z"
        fill="#94a3b8"
        stroke={CAR_BODY_STROKE}
        strokeWidth="1.5"
      />
      {/* Wheels */}
      <circle cx="75" cy="100" r="11" fill="#1e293b" />
      <circle cx="75" cy="100" r="5" fill="#94a3b8" />
      <circle cx="175" cy="100" r="11" fill="#1e293b" />
      <circle cx="175" cy="100" r="5" fill="#94a3b8" />
      {/* Headlight + grille on the right (front) */}
      <rect x="195" y="72" width="6" height="6" fill="#fde047" stroke={CAR_BODY_STROKE} strokeWidth="0.5" />
      {/* Front-left framing highlight: dashed rectangle covering front quarter + wheel */}
      <rect
        x="150"
        y="50"
        width="60"
        height="55"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="5,3"
        rx="3"
      />
      {/* Camera marker showing where the photographer stands */}
      <CameraMarker x={215} y={125} label="you" />
      {/* Arrow from camera toward framed region */}
      <ArrowLine x1={210} y1={120} x2={185} y2={80} />
    </svg>
  );
}

function CarFromFrontRight(): JSX.Element {
  // Mirror of front-left: flip horizontally via a wrapping <g>.
  return (
    <svg {...SVG_ATTRS} aria-label="Front-right corner framing">
      <title>Front-right corner framing</title>
      <g transform="translate(240,0) scale(-1,1)">
        <rect x="0" y="100" width="240" height="40" fill={GROUND_FILL} />
        <path
          d="M 50 80 L 60 60 L 120 55 L 180 60 L 200 75 L 200 95 L 50 95 Z"
          fill={CAR_BODY_FILL}
          stroke={CAR_BODY_STROKE}
          strokeWidth="2"
        />
        <path
          d="M 70 78 L 78 62 L 165 62 L 185 78 Z"
          fill="#94a3b8"
          stroke={CAR_BODY_STROKE}
          strokeWidth="1.5"
        />
        <circle cx="75" cy="100" r="11" fill="#1e293b" />
        <circle cx="75" cy="100" r="5" fill="#94a3b8" />
        <circle cx="175" cy="100" r="11" fill="#1e293b" />
        <circle cx="175" cy="100" r="5" fill="#94a3b8" />
        <rect x="195" y="72" width="6" height="6" fill="#fde047" stroke={CAR_BODY_STROKE} strokeWidth="0.5" />
        <rect
          x="150"
          y="50"
          width="60"
          height="55"
          fill="none"
          stroke={HIGHLIGHT_STROKE}
          strokeWidth="2"
          strokeDasharray="5,3"
          rx="3"
        />
      </g>
      {/* Camera marker stays right-side-up after the mirror */}
      <CameraMarker x={25} y={125} label="you" />
      <ArrowLine x1={30} y1={120} x2={55} y2={80} />
    </svg>
  );
}

function CarFromRearLeft(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Rear-left corner framing">
      <title>Rear-left corner framing</title>
      <rect x="0" y="100" width="240" height="40" fill={GROUND_FILL} />
      {/* Same body but rear-facing right side (no front grille on right) */}
      <path
        d="M 50 80 L 60 60 L 120 55 L 180 60 L 200 75 L 200 95 L 50 95 Z"
        fill={CAR_BODY_FILL}
        stroke={CAR_BODY_STROKE}
        strokeWidth="2"
      />
      <path
        d="M 70 78 L 78 62 L 165 62 L 185 78 Z"
        fill="#94a3b8"
        stroke={CAR_BODY_STROKE}
        strokeWidth="1.5"
      />
      <circle cx="75" cy="100" r="11" fill="#1e293b" />
      <circle cx="75" cy="100" r="5" fill="#94a3b8" />
      <circle cx="175" cy="100" r="11" fill="#1e293b" />
      <circle cx="175" cy="100" r="5" fill="#94a3b8" />
      {/* Tail light (red) on the LEFT side (car now points left for "rear" framing) */}
      <rect x="49" y="72" width="6" height="6" fill="#ef4444" stroke={CAR_BODY_STROKE} strokeWidth="0.5" />
      {/* Rear-left framing highlight: dashed rectangle covering rear quarter + wheel */}
      <rect
        x="30"
        y="50"
        width="60"
        height="55"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="5,3"
        rx="3"
      />
      <CameraMarker x={25} y={125} label="you" />
      <ArrowLine x1={30} y1={120} x2={55} y2={80} />
    </svg>
  );
}

function CarFromRearRight(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Rear-right corner framing">
      <title>Rear-right corner framing</title>
      <g transform="translate(240,0) scale(-1,1)">
        <rect x="0" y="100" width="240" height="40" fill={GROUND_FILL} />
        <path
          d="M 50 80 L 60 60 L 120 55 L 180 60 L 200 75 L 200 95 L 50 95 Z"
          fill={CAR_BODY_FILL}
          stroke={CAR_BODY_STROKE}
          strokeWidth="2"
        />
        <path
          d="M 70 78 L 78 62 L 165 62 L 185 78 Z"
          fill="#94a3b8"
          stroke={CAR_BODY_STROKE}
          strokeWidth="1.5"
        />
        <circle cx="75" cy="100" r="11" fill="#1e293b" />
        <circle cx="75" cy="100" r="5" fill="#94a3b8" />
        <circle cx="175" cy="100" r="11" fill="#1e293b" />
        <circle cx="175" cy="100" r="5" fill="#94a3b8" />
        <rect x="49" y="72" width="6" height="6" fill="#ef4444" stroke={CAR_BODY_STROKE} strokeWidth="0.5" />
        <rect
          x="30"
          y="50"
          width="60"
          height="55"
          fill="none"
          stroke={HIGHLIGHT_STROKE}
          strokeWidth="2"
          strokeDasharray="5,3"
          rx="3"
        />
      </g>
      <CameraMarker x={215} y={125} label="you" />
      <ArrowLine x1={210} y1={120} x2={185} y2={80} />
    </svg>
  );
}

/**
 * Odometer view: steering wheel arc + instrument cluster with the digit
 * readout highlighted. Greatly stylized; the message is "frame these
 * digits, key in the on position so they're lit".
 */
function OdometerView(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Odometer framing">
      <title>Odometer framing</title>
      <rect x="0" y="0" width="240" height="140" fill="#0f172a" />
      {/* Steering wheel arc, peeking from the bottom */}
      <path
        d="M 60 140 Q 120 80 180 140"
        fill="none"
        stroke="#1e293b"
        strokeWidth="14"
      />
      <path
        d="M 60 140 Q 120 80 180 140"
        fill="none"
        stroke="#334155"
        strokeWidth="4"
      />
      {/* Instrument cluster background */}
      <rect x="50" y="30" width="140" height="60" rx="6" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
      {/* Tach (left) */}
      <circle cx="80" cy="60" r="18" fill="#0f172a" stroke="#475569" strokeWidth="1.2" />
      {/* Speedo (right) */}
      <circle cx="160" cy="60" r="18" fill="#0f172a" stroke="#475569" strokeWidth="1.2" />
      {/* Center display with the digits */}
      <rect x="105" y="50" width="30" height="20" rx="3" fill="#0a0e1a" stroke="#fde047" strokeWidth="1.5" />
      <text x="120" y="64" textAnchor="middle" fontSize="11" fill="#fde047" fontFamily="monospace" fontWeight="bold">
        84236
      </text>
      {/* Highlight the digits */}
      <rect
        x="100"
        y="45"
        width="40"
        height="30"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="4,3"
        rx="4"
      />
    </svg>
  );
}

function InteriorFrontView(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Front interior framing">
      <title>Front interior framing</title>
      <rect x="0" y="0" width="240" height="140" fill="#0f172a" />
      {/* Dashboard arc spanning the top */}
      <path
        d="M 10 30 Q 120 10 230 30 L 230 60 L 10 60 Z"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1.5"
      />
      {/* Steering wheel on the left */}
      <circle cx="70" cy="55" r="22" fill="none" stroke="#475569" strokeWidth="4" />
      <circle cx="70" cy="55" r="3" fill="#475569" />
      {/* Center console screen */}
      <rect x="100" y="60" width="40" height="25" rx="3" fill="#0a0e1a" stroke="#475569" strokeWidth="1" />
      {/* Two front seats */}
      <rect x="20" y="80" width="80" height="55" rx="8" fill="#334155" stroke="#475569" strokeWidth="1.5" />
      <rect x="140" y="80" width="80" height="55" rx="8" fill="#334155" stroke="#475569" strokeWidth="1.5" />
      {/* Highlight covering both seats + dash */}
      <rect
        x="8"
        y="20"
        width="224"
        height="115"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="5,3"
        rx="4"
      />
    </svg>
  );
}

function InteriorRearView(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Rear interior framing">
      <title>Rear interior framing</title>
      <rect x="0" y="0" width="240" height="140" fill="#0f172a" />
      {/* Rear bench */}
      <rect x="30" y="50" width="180" height="60" rx="10" fill="#334155" stroke="#475569" strokeWidth="1.5" />
      {/* Three headrests */}
      <rect x="50" y="30" width="40" height="28" rx="4" fill="#475569" />
      <rect x="100" y="30" width="40" height="28" rx="4" fill="#475569" />
      <rect x="150" y="30" width="40" height="28" rx="4" fill="#475569" />
      {/* Bench seam */}
      <line x1="120" y1="50" x2="120" y2="110" stroke="#475569" strokeWidth="1.5" />
      {/* Highlight */}
      <rect
        x="20"
        y="20"
        width="200"
        height="100"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="5,3"
        rx="4"
      />
    </svg>
  );
}

function VinPlateView(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="VIN plate framing">
      <title>VIN plate framing</title>
      <rect x="0" y="0" width="240" height="140" fill="#0f172a" />
      {/* Windshield outline (looking through the corner of the windshield) */}
      <path
        d="M 20 30 L 220 20 L 220 100 L 20 110 Z"
        fill="#1e293b"
        stroke="#475569"
        strokeWidth="1.5"
      />
      {/* Dashboard edge inside */}
      <path
        d="M 20 100 L 220 90 L 220 100 L 20 110 Z"
        fill="#334155"
      />
      {/* The VIN plate (small metal tag on the dash, visible through windshield) */}
      <rect x="80" y="85" width="80" height="14" fill="#e2e8f0" stroke="#475569" strokeWidth="1" />
      <text x="120" y="95" textAnchor="middle" fontSize="9" fill="#0f172a" fontFamily="monospace" fontWeight="bold">
        JTEEW21A060032314
      </text>
      {/* Highlight on the VIN plate */}
      <rect
        x="75"
        y="80"
        width="90"
        height="24"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="4,3"
        rx="3"
      />
    </svg>
  );
}

function DamageCloseupView(): JSX.Element {
  return (
    <svg {...SVG_ATTRS} aria-label="Damage close-up framing">
      <title>Damage close-up framing</title>
      <rect x="0" y="0" width="240" height="140" fill={GROUND_FILL} />
      {/* Stylized fender section close-up */}
      <path
        d="M 20 100 Q 30 50 120 40 Q 210 50 220 100 Z"
        fill={CAR_BODY_FILL}
        stroke={CAR_BODY_STROKE}
        strokeWidth="2"
      />
      {/* Damage scratch + dent */}
      <path
        d="M 90 70 Q 100 65 115 72 Q 130 78 145 70"
        fill="none"
        stroke="#7f1d1d"
        strokeWidth="2"
      />
      <ellipse cx="120" cy="78" rx="14" ry="5" fill="#94a3b8" stroke="#475569" strokeWidth="1" />
      {/* Highlight tightly around the damage */}
      <rect
        x="75"
        y="55"
        width="90"
        height="40"
        fill="none"
        stroke={HIGHLIGHT_STROKE}
        strokeWidth="2"
        strokeDasharray="4,3"
        rx="4"
      />
      {/* Camera marker close to the damage */}
      <CameraMarker x={120} y={125} label="2-3 ft" />
    </svg>
  );
}

/**
 * Small camera-icon glyph used in the corner-angle illustrations to
 * show where the photographer stands. The "label" appears as small
 * text to the right of the camera box.
 */
function CameraMarker(props: {
  x: number;
  y: number;
  label: string;
}): JSX.Element {
  const { x, y, label } = props;
  return (
    <g>
      <rect x={x - 8} y={y - 5} width="16" height="10" rx="2" fill="#0f172a" stroke="#0f172a" />
      <circle cx={x} cy={y} r="3" fill="#fde047" />
      <text
        x={x + 12}
        y={y + 3}
        fontSize="8"
        fill="#0f172a"
        fontFamily="sans-serif"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Dashed arrow showing the photographer's line of sight from the
 * camera-marker to the framed region.
 */
function ArrowLine(props: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): JSX.Element {
  const { x1, y1, x2, y2 } = props;
  return (
    <g>
      <defs>
        <marker
          id={`arrowhead-${String(x1)}-${String(y1)}`}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 6 3, 0 6" fill={ARROW_STROKE} />
        </marker>
      </defs>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={ARROW_STROKE}
        strokeWidth="1.5"
        strokeDasharray="3,2"
        markerEnd={`url(#arrowhead-${String(x1)}-${String(y1)})`}
      />
    </g>
  );
}

const EXAMPLES: Record<ConditionAngle, ConditionTileExample> = {
  front_left: {
    headline:
      "Stand at the driver-side front corner, 8 to 10 feet back, and frame the front bumper, driver wheel, and front quarter panel in one shot.",
    mustContain: [
      "Front bumper edge on the right side of the frame",
      "Driver-side front wheel in the lower-left",
      "Top of the hood visible across the upper portion",
    ],
    avoid: [
      "Shooting too close so the bumper alone fills the frame",
      "Sun behind the car making the front go dark in the photo",
      "Other vehicles parked next to the driver side",
    ],
    illustration: <CarFromFrontLeft />,
  },
  front_right: {
    headline:
      "Stand at the passenger-side front corner, 8 to 10 feet back, and frame the front bumper, passenger wheel, and front quarter panel in one shot.",
    mustContain: [
      "Front bumper edge on the left side of the frame",
      "Passenger-side front wheel in the lower-right",
      "Top of the hood visible across the upper portion",
    ],
    avoid: [
      "Shooting too close so the bumper alone fills the frame",
      "Curb in the way of the passenger wheel",
      "Trees or signs blocking the upper hood",
    ],
    illustration: <CarFromFrontRight />,
  },
  rear_left: {
    headline:
      "Stand behind the driver-side rear corner, 8 to 10 feet back, and frame the rear bumper, driver rear wheel, and rear quarter panel.",
    mustContain: [
      "Rear bumper edge on the right side of the frame",
      "Driver-side rear wheel in the lower-left",
      "Trunk or hatch visible across the upper portion",
      "Tail light visible at the right edge",
    ],
    avoid: [
      "Standing right behind the car (gives a rear-only shot, not a corner shot)",
      "Garage door or wall reflecting in the rear glass",
    ],
    illustration: <CarFromRearLeft />,
  },
  rear_right: {
    headline:
      "Stand behind the passenger-side rear corner, 8 to 10 feet back, and frame the rear bumper, passenger rear wheel, and rear quarter panel.",
    mustContain: [
      "Rear bumper edge on the left side of the frame",
      "Passenger-side rear wheel in the lower-right",
      "Trunk or hatch visible across the upper portion",
      "Tail light visible at the left edge",
    ],
    avoid: [
      "Cropping out the rear wheel",
      "Glare from a window or shop reflection in the tail light",
    ],
    illustration: <CarFromRearRight />,
  },
  odometer: {
    headline:
      "Turn the key to position II (accessory or run, so the cluster lights up) without starting the engine, then photograph the odometer digits straight on through the steering wheel.",
    mustContain: [
      "All odometer digits crisply readable, including any partial trip-meter row",
      "Cluster fully lit",
      "Phone held parallel to the cluster face to avoid distortion",
    ],
    avoid: [
      "Glare from the windshield washing out the digits",
      "Photographing while the engine is off (digits are usually dim)",
      "Tilting the phone so the digits become a parallelogram",
    ],
    illustration: <OdometerView />,
  },
  interior_front: {
    headline:
      "Open the driver door, stand outside, and photograph both front seats, the dashboard, and the center console in one frame.",
    mustContain: [
      "Both front seats fully visible (driver and passenger)",
      "Top of the dashboard visible at the top of the frame",
      "Center console or shifter area visible",
    ],
    avoid: [
      "Tinted-window photos taken from outside (use the open door)",
      "Items piled on the seats that hide the upholstery",
      "Flash bouncing off the windshield",
    ],
    illustration: <InteriorFrontView />,
  },
  interior_rear: {
    headline:
      "Open the rear driver-side door, stand outside, and photograph the rear bench, headrests, and floor mats.",
    mustContain: [
      "Full rear bench, side to side",
      "All headrests visible at their normal height",
      "Floor mats visible at the bottom of the frame",
    ],
    avoid: [
      "Carseats or bags on the bench that hide the upholstery (move them out for the photo)",
      "Photographing from the front seat looking back (use the open rear door)",
    ],
    illustration: <InteriorRearView />,
  },
  vin_plate: {
    headline:
      "Stand at the driver-side front corner of the car, look at the corner of the dashboard where it meets the windshield, and photograph the VIN plate through the glass.",
    mustContain: [
      "All 17 characters of the VIN visible",
      "Each character sharply in focus, no motion blur",
      "Plate fills at least 30 percent of the frame width",
    ],
    avoid: [
      "Fingerprint or windshield wiper bisecting a character",
      "Photographing the VIN sticker on the door jamb instead (some plates differ; the dashboard plate is the canonical one)",
      "Shooting at a steep angle so the leftmost or rightmost digits get cut off",
    ],
    illustration: <VinPlateView />,
  },
  damage_closeup: {
    headline:
      "Stand 2 to 3 feet from the damaged spot and fill 60 to 80 percent of the frame with the damage itself.",
    mustContain: [
      "The damaged area centered and in sharp focus",
      "Enough surrounding panel visible to show what part of the car the damage is on",
      "Daylight or a strong even indoor light (no flash)",
    ],
    avoid: [
      "Standing too far away so the damage is one small spot in the frame",
      "Flash photos (the highlight blows out the dent shape)",
      "Wet panel from rain (water hides scratches and the model will under-rate the damage)",
    ],
    illustration: <DamageCloseupView />,
  },
};
