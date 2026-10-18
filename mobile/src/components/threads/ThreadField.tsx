import React, {useEffect,useMemo,useState} from 'react';
import {StyleSheet,View,type LayoutChangeEvent} from 'react-native';
import {BlendMode,BlurStyle,Canvas,FractalNoise,PaintStyle,Picture,Rect,Shader,Skia,StrokeCap,StrokeJoin} from '@shopify/react-native-skia';
import {useDerivedValue,useFrameCallback,useSharedValue} from 'react-native-reanimated';
import {advanceCanonicalThreadPhase,consumeCanonicalThreadFrameBudget,canonicalThreadPaint,canonicalFrameTerms,canonicalPreparedPoint,prepareCanonicalThreads,REDUCED_MOTION_PHASE,THREAD_COUNT} from '../../../../shared/threads/ThreadGeometry';

// Direct CSS gradient translation. Unlike a stretched bitmap, percentage
// radii and 9dp diagonal repeats retain their meaning after rotation/resize.
const background=Skia.RuntimeEffect.Make(`
uniform float2 size; uniform float overlay;
half4 main(float2 p) {
  float2 q=p/size;
  if (overlay>0.5) {
    float radius=length(float2(size.x*.78,size.y*.87));
    float a=.14*clamp(1.-length(p-size*float2(.78,.13))/(radius*.27),0.,1.);
    half4 radial=half4(half3(116.,183.,151.)/255.*a,a);
    float fade= q.y<.55 ? clamp((q.y-.42)/.13,0.,1.)*.1 : .1+clamp((q.y-.55)/.18,0.,1.)*.9;
    return radial+half4(half3(6.,19.,15.)/255.*fade,fade)*(1.-a);
  }
  float stripe=mod(p.x*.4067366431-p.y*.9135454576+size.y*.9135454576,9.);
  float sa=.035*clamp(stripe-7.,0.,1.);
  half3 base=half3(6.,19.,15.)/255.;
  base=mix(base,half3(212.,235.,220.)/255.,sa);
  float d=length((q-float2(.61,.38))/float2(.78,.23));
  float a=.34*clamp(1.-d/.68,0.,1.);
  return half4(mix(base,half3(215.,239.,223.)/255.,a),1.);
}`)!;

type Size={width:number;height:number};
function ThreadCanvas({width,height,active,reducedMotion}:Size&{active:boolean;reducedMotion:boolean}){
  const phase=useSharedValue(reducedMotion?REDUCED_MOTION_PHASE:0);
  const frameBudgetMs=useSharedValue(0);
  const frame=useFrameCallback(info=>{'worklet';const budget=consumeCanonicalThreadFrameBudget(frameBudgetMs.value,info.timeSincePreviousFrame??0);frameBudgetMs.value=budget.pendingMs;if(budget.shouldRender)phase.value=advanceCanonicalThreadPhase(phase.value,budget.elapsedMs,{active:true,reducedMotion:false});},false);
  useEffect(()=>{if(reducedMotion)phase.value=REDUCED_MOTION_PHASE;frameBudgetMs.value=0;frame.setActive(active&&!reducedMotion);return()=>{frame.setActive(false);frameBudgetMs.value=0;};},[active,reducedMotion,frame,frameBudgetMs,phase]);
  const inks=useMemo(()=>Array.from({length:THREAD_COUNT},(_,index)=>{
    const ink=canonicalThreadPaint(index);
    const paint=Skia.Paint();paint.setAntiAlias(true);paint.setStyle(PaintStyle.Stroke);paint.setStrokeCap(StrokeCap.Round);paint.setStrokeJoin(StrokeJoin.Round);paint.setStrokeWidth(ink.width);paint.setBlendMode(BlendMode.Screen);paint.setColor(Skia.Color(`rgba(${ink.red},${ink.green},${ink.blue},${ink.alpha})`));
    const glow=paint.copy();glow.setColor(Skia.Color(`rgba(203,244,220,${ink.alpha*.7})`));glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal,ink.shadowBlur/2,true));
    return{paint,glow};
  }),[]);
  const prepared=useMemo(()=>prepareCanonicalThreads(width,height),[width,height]);
  // One UI-runtime derived picture replaces 88 independent path worklets.
  const picture=useDerivedValue(()=>{
    const recorder=Skia.PictureRecorder();const canvas=recorder.beginRecording(Skia.XYWHRect(0,0,width,height));
    const terms=canonicalFrameTerms(phase.value);
    for(let index=0;index<THREAD_COUNT;index++){
      // One bulk native transfer per lane, not one JSI call per vertex.
      const path=Skia.Path.Polygon(prepared[index].map(vertex=>canonicalPreparedPoint(vertex,terms)),false);
      canvas.drawPath(path,inks[index].glow);canvas.drawPath(path,inks[index].paint);
    }
    return recorder.finishRecordingAsPicture();
  });
  return <Canvas style={styles.canvas} opaque>
    <Rect x={0} y={0} width={width} height={height}><Shader source={background} uniforms={{size:[width,height],overlay:0}}/></Rect>
    <Picture picture={picture}/>
    <Rect x={0} y={0} width={width} height={height}><Shader source={background} uniforms={{size:[width,height],overlay:1}}/></Rect>
    <Rect x={0} y={0} width={width} height={height} opacity={.14*.45} blendMode="softLight"><FractalNoise freqX={.85} freqY={.85} octaves={2} seed={0} tileWidth={160} tileHeight={160}/></Rect>
  </Canvas>;
}
export function ThreadField({active,reducedMotion}:{active:boolean;reducedMotion:boolean}){
  const [size,setSize]=useState<Size>({width:0,height:0});
  const onLayout=(event:LayoutChangeEvent)=>{const{width,height}=event.nativeEvent.layout;setSize(current=>current.width===width&&current.height===height?current:{width,height});};
  return <View style={styles.host} onLayout={onLayout} pointerEvents="none" accessibilityElementsHidden>{size.width>0&&size.height>0?<ThreadCanvas {...size} active={active} reducedMotion={reducedMotion}/>:null}</View>;
}
const styles=StyleSheet.create({host:{position:'absolute',inset:0,overflow:'hidden',backgroundColor:'#06130f'},canvas:{position:'absolute',inset:0}});
