import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
export interface Spec extends TurboModule { execute(action:string,body:string):Promise<string>; }
export default TurboModuleRegistry.getEnforcing<Spec>('NativeAnalysis');
