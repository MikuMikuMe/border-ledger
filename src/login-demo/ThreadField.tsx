import { useEffect, useRef } from 'react';
import {
  advanceCanonicalThreadPhase,
  CANONICAL_THREAD_STEPS,
  canonicalThreadPaint,
  canonicalThreadPoint,
  REDUCED_MOTION_PHASE,
  THREAD_COUNT,
  type CanonicalThreadPointInput,
} from '../../shared/threads/ThreadGeometry';

export function ThreadField() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host) return;
    if (!canvas) return;
    const context = canvas?.getContext('2d');
    if (!context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 1, height = 1, frame = 0;
    let visible = true;
    let lastTime: number | undefined;
    let phase = reducedMotion ? REDUCED_MOTION_PHASE : 0;
    const size = { width, height };
    const pointer = { x: 0.5, y: 0.32 };
    const target = { ...pointer };
    const pointInput: CanonicalThreadPointInput = { index: 0, step: 0, size, phase, pointer };
    const paint = () => {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'screen';
      context.lineCap = 'round';
      for (let index = 0; index < THREAD_COUNT; index += 1) {
        const ink = canonicalThreadPaint(index);
        pointInput.index = index;
        context.beginPath();
        for (let step = 0; step <= CANONICAL_THREAD_STEPS; step += 1) {
          pointInput.step = step;
          const point = canonicalThreadPoint(pointInput);
          if (step === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
        }
        context.strokeStyle = `rgba(${ink.red},${ink.green},${ink.blue},${ink.alpha})`;
        context.lineWidth = ink.width;
        context.shadowColor = `rgba(203,244,220,${ink.alpha * 0.7})`;
        context.shadowBlur = ink.shadowBlur;
        context.stroke();
      }
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.6);
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      size.width = width; size.height = height;
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Canvas resize clears the bitmap, including when motion is reduced.
      paint();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const bounds = host.getBoundingClientRect();
      target.x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      target.y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    };
    const draw = (now: number) => {
      if (!visible) return;
      pointer.x += (target.x - pointer.x) * 0.045; pointer.y += (target.y - pointer.y) * 0.045;
      phase = advanceCanonicalThreadPhase({ currentPhase: phase, elapsedMs: lastTime === undefined ? 0 : now - lastTime, active: true, reducedMotion: false });
      pointInput.phase = phase;
      lastTime = now; paint(); frame = requestAnimationFrame(draw);
    };
    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      const nextVisible = entry.isIntersecting;
      if (nextVisible !== visible) {
        visible = nextVisible;
        if (visible) {
          if (!reducedMotion) { lastTime = undefined; frame = requestAnimationFrame(draw); }
        } else {
          cancelAnimationFrame(frame);
        }
      }
    });
    resizeObserver.observe(host); intersectionObserver.observe(host);
    window.addEventListener('pointermove', move, { passive: true });
    resize(); if (!reducedMotion) frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); resizeObserver.disconnect(); intersectionObserver.disconnect(); window.removeEventListener('pointermove', move); };
  }, []);
  return <div ref={hostRef} className="thread-field" aria-hidden="true"><canvas ref={canvasRef} /></div>;
}
