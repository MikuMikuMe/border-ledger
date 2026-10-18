import { describe, expect, it } from 'vitest';
import {
  advanceThreadPhase,
  REDUCED_MOTION_PHASE,
  THREAD_COUNT,
  TWO_PI,
  threadGeometry,
  threadPhase,
  threadPhaseFromCycleProgress,
} from '../shared/threads/ThreadGeometry';

describe('thread geometry', () => {
  it('keeps the reduced-motion frame deterministic while live motion advances', () => {
    expect(threadPhase(91_500, { active: true, reducedMotion: true })).toBe(REDUCED_MOTION_PHASE);
    expect(threadPhase(5_000, { active: false, reducedMotion: false, pausedPhase: 0.73 })).toBe(0.73);
    expect(threadPhase(5_000, { active: true, reducedMotion: false })).toBeCloseTo(0.638, 7);
  });

  it('matches hand-checked cubic samples at the fixed reduced-motion phase', () => {
    expect(threadGeometry(0, 412, 915, REDUCED_MOTION_PHASE)).toEqual({
      startX: -22.66,
      startY: 42.717847,
      control1X: 119.48,
      control1Y: 266.521341,
      control2X: 296.64,
      control2Y: 615.144905,
      endX: 434.66,
      endY: 102.342083,
      intensity: 0.263405,
      champagne: false,
    });
    expect(threadGeometry(43, 412, 915, REDUCED_MOTION_PHASE)).toEqual({
      startX: -22.66,
      startY: 443.191701,
      control1X: 119.48,
      control1Y: 404.27578,
      control2X: 296.64,
      control2Y: 674.882315,
      endX: 434.66,
      endY: 473.982327,
      intensity: 0.507175,
      champagne: false,
    });
  });

  it('converts the Kotlin normalized cycle fixture to radians before evaluating the approved equations', () => {
    const phase = threadPhaseFromCycleProgress(0.37);

    expect(phase).toBeCloseTo(2.324778564, 9);
    expect(threadGeometry(0, 412, 915, phase)).toEqual({
      startX: -22.66,
      startY: 40.029076,
      control1X: 119.48,
      control1Y: 243.218655,
      control2X: 296.64,
      control2Y: 589.099401,
      endX: 434.66,
      endY: 92.433468,
      intensity: 0.263405,
      champagne: false,
    });
  });

  it('advances a radians phase across frames while preserving pause and reduced-motion behavior', () => {
    expect(advanceThreadPhase(1.8, 1_000, { active: true, reducedMotion: false }))
      .toBeCloseTo(1.9276, 7);
    expect(advanceThreadPhase(TWO_PI - 0.01, 1_000, { active: true, reducedMotion: false }))
      .toBeCloseTo(0.1176, 7);
    expect(advanceThreadPhase(0.73, 1_000, { active: false, reducedMotion: false })).toBe(0.73);
    expect(advanceThreadPhase(0.73, 1_000, { active: true, reducedMotion: true }))
      .toBe(REDUCED_MOTION_PHASE);
  });

  it('keeps all 88 strands finite and beyond both horizontal edges', () => {
    const strands = Array.from({ length: THREAD_COUNT }, (_, index) =>
      threadGeometry(index, 412, 915, 0.37),
    );

    expect(strands).toHaveLength(88);
    expect(strands.every((strand) => Object.values(strand).every((value) =>
      typeof value === 'boolean' || Number.isFinite(value),
    ))).toBe(true);
    expect(strands.every((strand) => strand.startX < 0 && strand.endX > 412)).toBe(true);
    expect(strands.filter((strand) => strand.champagne)).toHaveLength(7);
  });
});
