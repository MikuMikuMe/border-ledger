/** DOM-free artwork. Cubic exports retain legacy Compose fixture provenance. */
export const THREAD_COUNT = 88;
export const THREAD_SPEED = 0.58;
export const REDUCED_MOTION_PHASE = 1.8;
export const TWO_PI = Math.PI * 2;
export const CANONICAL_THREAD_TARGET_FPS = 30;
export const CANONICAL_THREAD_FRAME_INTERVAL_MS = 1000 / CANONICAL_THREAD_TARGET_FPS;

export type CanonicalThreadFrameBudget = {
  shouldRender: boolean;
  elapsedMs: number;
  pendingMs: number;
};

export type ThreadDimensions = Readonly<{ width: number; height: number }>;
export type CanonicalFrameTiming = Readonly<{ pendingMs: number; elapsedMs: number }>;

/** Accumulates display time and releases at most one render per 30fps interval. */
export function consumeCanonicalThreadFrameBudget({ pendingMs, elapsedMs }: CanonicalFrameTiming): CanonicalThreadFrameBudget {
  'worklet';
  const totalMs = Math.max(0, pendingMs) + Math.max(0, elapsedMs);
  if (totalMs + 0.000001 < CANONICAL_THREAD_FRAME_INTERVAL_MS) {
    return { shouldRender: false, elapsedMs: 0, pendingMs: totalMs };
  }
  return { shouldRender: true, elapsedMs: totalMs, pendingMs: 0 };
}

export type ThreadPhaseOptions = {
  active: boolean;
  reducedMotion: boolean;
  pausedPhase?: number;
};

export type ThreadPhaseInput = ThreadPhaseOptions & Readonly<{ elapsedMs: number }>;
export type ThreadPhaseAdvanceInput = Pick<ThreadPhaseOptions, 'active' | 'reducedMotion'> & Readonly<{
  currentPhase: number;
  elapsedMs: number;
}>;

export type ThreadGeometryInput = Readonly<{
  index: number;
  size: ThreadDimensions;
  phase: number;
}>;

export type CanonicalThreadPointInput = {
  index: number;
  step: number;
  size: ThreadDimensions;
  phase: number;
  pointer?: CanonicalPointer;
};

export type ThreadGeometry = {
  startX: number;
  startY: number;
  control1X: number;
  control1Y: number;
  control2X: number;
  control2Y: number;
  endX: number;
  endY: number;
  intensity: number;
  champagne: boolean;
};

const roundFixture = (value: number) => {
  'worklet';
  return Math.round(value * 1_000_000) / 1_000_000;
};

function assertThreadIndex(index: number, errorMessage: string): void {
  'worklet';
  if (!Number.isInteger(index)) throw new RangeError(errorMessage);
  if (index < 0) throw new RangeError(errorMessage);
  if (index >= THREAD_COUNT) throw new RangeError(errorMessage);
}

function assertThreadDimension(value: number, errorMessage: string): void {
  'worklet';
  if (!Number.isFinite(value)) throw new RangeError(errorMessage);
  if (value < 0) throw new RangeError(errorMessage);
}

function assertThreadDimensions(
  { width, height }: ThreadDimensions,
  errorMessage = 'Thread dimensions must be finite and non-negative.',
): void {
  'worklet';
  assertThreadDimension(width, errorMessage);
  assertThreadDimension(height, errorMessage);
}

function assertCanonicalThreadStep(step: number): void {
  'worklet';
  if (!Number.isInteger(step)) throw new RangeError('Invalid thread vertex.');
  if (step < 0) throw new RangeError('Invalid thread vertex.');
  if (step > CANONICAL_THREAD_STEPS) throw new RangeError('Invalid thread vertex.');
}

function assertFinitePhase(phase: number): void {
  'worklet';
  if (!Number.isFinite(phase)) throw new RangeError('Invalid thread dimensions or phase.');
}

export function threadPhase({ elapsedMs, ...options }: ThreadPhaseInput): number {
  'worklet';
  if (options.reducedMotion) return REDUCED_MOTION_PHASE;
  if (!options.active) return options.pausedPhase ?? 0;
  return (Math.max(0, elapsedMs) * 0.00022 * THREAD_SPEED) % TWO_PI;
}

/** Converts the Compose fixture's normalized cycle progress to renderer radians. */
export function threadPhaseFromCycleProgress(progress: number): number {
  'worklet';
  const bounded = Math.min(1, Math.max(0, progress));
  return bounded === 1 ? 0 : bounded * TWO_PI;
}

/** Advances an existing radians phase without losing its position across app pauses. */
export function advanceThreadPhase({ currentPhase, elapsedMs, ...options }: ThreadPhaseAdvanceInput): number {
  'worklet';
  if (options.reducedMotion) return REDUCED_MOTION_PHASE;
  if (!options.active) return currentPhase;
  return (currentPhase + Math.max(0, elapsedMs) * 0.00022 * THREAD_SPEED) % TWO_PI;
}

/**
 * The cubic equations are the legacy Compose login artwork, expressed without
 * Compose, Canvas, DOM, or Skia dependencies. Coordinates are rounded only to
 * make deterministic web/native fixtures stable across JS engines.
 */
export function threadGeometry({ index, size, phase }: ThreadGeometryInput): ThreadGeometry {
  'worklet';
  assertThreadIndex(index, `Thread index must be an integer from 0 to ${THREAD_COUNT - 1}.`);
  assertThreadDimensions(size);
  const { width, height } = size;

  const position = index / (THREAD_COUNT - 1);
  const strandPhase = position * 4.8;
  const firstWave = Math.sin(phase + strandPhase);
  const secondWave = Math.cos(phase * 0.82 + strandPhase * 0.72 + 0.64);
  const focus = Math.min(1, Math.max(0, 1 - Math.abs(position - 0.43) * 1.55));

  return {
    startX: roundFixture(-width * 0.055),
    startY: roundFixture(height * (0.035 + position * 0.93 + firstWave * 0.012)),
    control1X: roundFixture(width * 0.29),
    control1Y: roundFixture(height * (0.19 + position * 0.69 + firstWave * 0.104)),
    control2X: roundFixture(width * 0.72),
    control2Y: roundFixture(height * (0.72 + position * 0.18 + secondWave * 0.092)),
    endX: roundFixture(width * 1.055),
    endY: roundFixture(height * (0.13 + position * 0.84 + secondWave * 0.035)),
    intensity: roundFixture(0.12 + focus * 0.43),
    champagne: index % 13 === 6,
  };
}

/** First-generated ThreadLoginConcept: 88 lanes, each with 73 polyline vertices. */
export const CANONICAL_THREAD_STEPS = 72;
export type CanonicalPointer = { x: number; y: number };

export function canonicalThreadPaint(index: number) {
  'worklet';
  assertThreadIndex(index, 'Invalid thread index.');
  const lane = index / (THREAD_COUNT - 1) - 0.5;
  const alpha = 0.055 + 0.14 * Math.pow(1 - Math.abs(lane * 1.5), 2);
  const champagne = Math.max(0, 1 - Math.abs(lane - 0.22) * 5);
  return {
    red: Math.round(205 + champagne * 30), green: Math.round(230 + champagne * 3),
    blue: Math.round(217 - champagne * 34), alpha, width: 0.65 + champagne * 0.35,
    shadowBlur: index % 9 === 0 ? 7 : 1,
  };
}

export function canonicalThreadPoint({ index, step, size, phase, pointer }: CanonicalThreadPointInput) {
  'worklet';
  assertThreadIndex(index, 'Invalid thread vertex.');
  assertCanonicalThreadStep(step);
  assertThreadDimensions(size, 'Invalid thread dimensions or phase.');
  assertFinitePhase(phase);
  const { width, height } = size;
  const pointerPosition = pointer ?? { x: 0.5, y: 0.32 };
  const lane = index / (THREAD_COUNT - 1) - 0.5;
  const progress = step / CANONICAL_THREAD_STEPS;
  const focus = Math.exp(-Math.pow(progress - 0.58, 2) / 0.085);
  const wave = Math.sin(progress * 7.2 + phase * 2.2 + lane * 2.7) * 24;
  const fray = Math.sin(progress * 23 + phase * 3.1 + index * 0.34) * 2.7;
  const pointerPull = (pointerPosition.y - 0.42) * 34 * Math.exp(-Math.pow(progress - pointerPosition.x, 2) / 0.04);
  const center = height * (0.34 + progress * 0.11) + Math.sin(phase * 1.3) * 18;
  const spread = lane * (34 + focus * 185);
  return { x: -width * 0.15 + progress * width * 1.3, y: center + spread + wave * (1 - focus * 0.28) + fray + pointerPull };
}

export function advanceCanonicalThreadPhase({ currentPhase, elapsedMs, ...options }: ThreadPhaseAdvanceInput) {
  'worklet';
  if (options.reducedMotion) return REDUCED_MOTION_PHASE;
  if (!options.active) return currentPhase;
  // Noninteger frequencies mean 2π is NOT a common period; wrapping causes jumps.
  return currentPhase + Math.max(0, elapsedMs) * 0.00022 * THREAD_SPEED;
}

export type CanonicalPreparedVertex = { x: number; base: number; waveSin: number; waveCos: number; fraySin: number; frayCos: number };
/** Prepare only invariant terms; no vertex removal, quantization or new curves. */
export function prepareCanonicalThreads({ width, height }: ThreadDimensions): CanonicalPreparedVertex[][] {
  assertThreadDimensions({ width, height }, 'Invalid thread dimensions.');
  return Array.from({length:THREAD_COUNT},(_,index)=>Array.from({length:CANONICAL_THREAD_STEPS+1},(_,step)=>{
    const lane=index/(THREAD_COUNT-1)-.5,progress=step/CANONICAL_THREAD_STEPS;
    const focus=Math.exp(-Math.pow(progress-.58,2)/.085),wave=progress*7.2+lane*2.7,fray=progress*23+index*.34;
    const amplitude=24*(1-focus*.28);
    return {x:-width*.15+progress*width*1.3,
      base:height*(.34+progress*.11)+lane*(34+focus*185)+(.32-.42)*34*Math.exp(-Math.pow(progress-.5,2)/.04),
      waveSin:Math.sin(wave)*amplitude,waveCos:Math.cos(wave)*amplitude,
      fraySin:Math.sin(fray)*2.7,frayCos:Math.cos(fray)*2.7};
  }));
}
export function canonicalFrameTerms(phase:number){
  'worklet';
  return{offset:Math.sin(phase*1.3)*18,waveSin:Math.sin(phase*2.2),waveCos:Math.cos(phase*2.2),fraySin:Math.sin(phase*3.1),frayCos:Math.cos(phase*3.1)};
}
export function canonicalPreparedPoint(vertex:CanonicalPreparedVertex,terms:ReturnType<typeof canonicalFrameTerms>){
  'worklet';
  return{x:vertex.x,y:vertex.base+terms.offset+vertex.waveSin*terms.waveCos+vertex.waveCos*terms.waveSin+vertex.fraySin*terms.frayCos+vertex.frayCos*terms.fraySin};
}
