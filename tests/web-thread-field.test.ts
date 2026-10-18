// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadField } from '../src/login-demo/ThreadField';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('repaints all fixed-phase strands after initial and later resize observations under reduced motion', () => {
  let resize!: ResizeObserverCallback;
  let bounds = { width: 412, height: 915 };
  let strokes: number[][] = [];
  let path: number[] = [];
  const gradient = { addColorStop() {} };
  const context = {
    setTransform() {}, clearRect() { strokes = []; },
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    fillRect() {}, save() {}, restore() {}, translate() {},
    beginPath() { path = []; }, moveTo(x: number, y: number) { path.push(x, y); },
    lineTo(x: number, y: number) { path.push(x, y); },
    bezierCurveTo(...coordinates: number[]) { path.push(...coordinates); },
    stroke() { strokes.push([...path]); },
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  // A browser clears the bitmap whenever either canvas dimension is assigned.
  vi.spyOn(HTMLCanvasElement.prototype, 'width', 'set').mockImplementation(() => { strokes = []; });
  vi.spyOn(HTMLCanvasElement.prototype, 'height', 'set').mockImplementation(() => { strokes = []; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds as DOMRect);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const requestFrame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', requestFrame);
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {} disconnect() {}
  });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(createElement(ThreadField)));
  expect(strokes).toHaveLength(88);

  act(() => resize([], {} as ResizeObserver));
  expect(strokes).toHaveLength(88);
  expect(strokes[0]).toHaveLength(146);
  expect(strokes[0].slice(0, 2)).toEqual([-61.8, 315.6130285494536]);

  bounds = { width: 300, height: 600 };
  act(() => resize([], {} as ResizeObserver));
  expect(strokes).toHaveLength(88);
  expect(strokes[0]).toHaveLength(146);
  expect(strokes[0].slice(0, 2)).toEqual([-45, 208.51302854945362]);
  expect(requestFrame).not.toHaveBeenCalled();
});
