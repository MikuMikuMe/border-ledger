import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation={operationId:string;kind:string;status:string;updatedAt:string;resultId:string|null};
export interface Spec extends TurboModule {
  readSettings():Promise<string>;
  readView(month:string):Promise<string>;
  startWrite(operationId:string,action:string,body:string):Promise<Operation>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeBudget');
