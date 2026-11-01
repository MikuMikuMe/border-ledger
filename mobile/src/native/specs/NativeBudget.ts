import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
type Operation={operationId:string;kind:string;status:string;updatedAt:string;resultId:string|null};
export type MonthRequest={month:string};
export type ModeViewRequest={month:string;mode:string};
export type RolloverRequest={category:string;effectiveMonth:string;policy:string};
export interface Spec extends TurboModule {
  readSettings():Promise<string>;
  readView(month:string):Promise<string>;
  readModeView(request:ModeViewRequest):Promise<string>;
  readCopyPreview(request:MonthRequest):Promise<string>;
  readRolloverPreview(request:RolloverRequest):Promise<string>;
  startWrite(operationId:string,action:string,body:string):Promise<Operation>;
}
export default TurboModuleRegistry.getEnforcing<Spec>('NativeBudget');
