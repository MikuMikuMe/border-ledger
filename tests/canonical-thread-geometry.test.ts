import {describe,expect,it} from 'vitest';
import * as threadGeometry from '../shared/threads/ThreadGeometry';
import {advanceCanonicalThreadPhase,canonicalThreadPaint,canonicalThreadPoint,prepareCanonicalThreads,canonicalFrameTerms,canonicalPreparedPoint} from '../shared/threads/ThreadGeometry';

// Literal fake-canvas calls from immutable original ThreadField.tsx SHA256
// 795e625c2c8783fd089d97e5fe78875517c04305d1b0f528a60a01630da42791.
// The expected points are not calculated with this shared implementation.
describe('first-generated Thread Field geometry',()=>{
 it('preserves every original vertex when phase-independent terms are batched',()=>{
  const prepared=prepareCanonicalThreads(412,915);
  expect(prepared).toHaveLength(88);expect(prepared.every(lane=>lane.length===73)).toBe(true);
  for(const phase of [0,1.8,6.3,100.5]){const terms=canonicalFrameTerms(phase);for(let i=0;i<88;i++)for(let step=0;step<=72;step++){const p=canonicalPreparedPoint(prepared[i][step],terms),original=canonicalThreadPoint(i,step,412,915,phase);expect(p.x).toBe(original.x);expect(p.y).toBeCloseTo(original.y,10);}}
 });
 it('matches original 412x915 phase1.8 polylines, including the compact focal band',()=>{
  const samples=[
   [0,0,-61.8,315.6130285494536],[0,36,206,264.220335107123],[0,72,473.8,386.5513380899104],
   [43,0,-61.8,309.2723712098874],[43,36,206,387.4557869562472],[43,72,473.8,399.5434372127516],
   [87,0,-61.8,321.52901507952953],[87,36,206,483.7040926595515],[87,72,473.8,454.67948351810725],
  ];
  for(const [index,step,x,y]of samples){const actual=canonicalThreadPoint(index,step,412,915,1.8);expect(actual.x).toBeCloseTo(x,10);expect(actual.y).toBeCloseTo(y,10);}
 });
 it('retains the canonical resize and all 88x73 finite vertices',()=>{
  expect(canonicalThreadPoint(0,0,300,600,1.8)).toEqual({x:-45,y:208.51302854945362});
  for(let i=0;i<88;i++)for(let step=0;step<=72;step++){const p=canonicalThreadPoint(i,step,412,915,1.8);expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true);}
 });
 it('retains lane paint and every ninth strand glow instead of seven champagne Beziers',()=>{
  expect(canonicalThreadPaint(0)).toEqual({red:205,green:230,blue:217,alpha:.06375,width:.65,shadowBlur:7});
  expect(canonicalThreadPaint(43)).toEqual({red:205,green:230,blue:217,alpha:.19259661117717006,width:.65,shadowBlur:1});
  expect(canonicalThreadPaint(63)).toEqual({red:234,green:233,blue:184,alpha:.11668697978596909,width:.9927586206896551,shadowBlur:7});
  expect(Array.from({length:88},(_,i)=>canonicalThreadPaint(i)).filter(p=>p.shadowBlur===7)).toHaveLength(10);
 });
 it('does not wrap at 2pi because the original wave multipliers are noninteger',()=>{
  const initial=Math.PI*2-.01;
  expect(advanceCanonicalThreadPhase(initial,1000,{active:true,reducedMotion:false})).toBeCloseTo(initial+.1276,10);
  expect(advanceCanonicalThreadPhase(.73,1000,{active:false,reducedMotion:false})).toBe(.73);
  expect(advanceCanonicalThreadPhase(.73,1000,{active:true,reducedMotion:true})).toBe(1.8);
 });
 it('caps redraw cadence at 30fps on 60Hz and 120Hz displays without dropping phase time',()=>{
  expect(typeof threadGeometry.consumeCanonicalThreadFrameBudget).toBe('function');
  for(const refreshRate of [60,120]){
   let pendingMs=0,renderedFrames=0,advancedMs=0;
   for(let frame=0;frame<refreshRate;frame++){
    const budget=threadGeometry.consumeCanonicalThreadFrameBudget(pendingMs,1000/refreshRate);
    pendingMs=budget.pendingMs;
    if(budget.shouldRender){renderedFrames++;advancedMs+=budget.elapsedMs;}
   }
   expect(renderedFrames).toBe(30);
   expect(advancedMs).toBeCloseTo(1000,6);
   expect(pendingMs).toBeCloseTo(0,6);
  }
 });
 it('rejects invalid point indexes and dimensions instead of drawing corrupt paths',()=>{
  expect(()=>canonicalThreadPoint(88,0,412,915,1.8)).toThrow(RangeError);
  expect(()=>canonicalThreadPoint(0,73,412,915,1.8)).toThrow(RangeError);
  expect(()=>canonicalThreadPoint(0,0,Number.NaN,915,1.8)).toThrow(RangeError);
 });
});
