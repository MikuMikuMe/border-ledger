import React from 'react';
import {Image} from 'react-native';
// Exact canonical Lucide0.468 SVGs rasterized transparently at3x, not redrawn.
// Static RN images avoid allocating three independent GPU-backed icon canvases.
const ICONS={fingerprint:require('../../../assets/icons/thread-fingerprint.png'),arrow:require('../../../assets/icons/thread-arrow.png'),shield:require('../../../assets/icons/thread-shield.png')};
export function LoginIcon({name,size,color}:{name:keyof typeof ICONS;size:number;color:string}){
  return <Image source={ICONS[name]} style={{width:size,height:size,tintColor:color}} resizeMode="contain" accessible={false}/>;
}
