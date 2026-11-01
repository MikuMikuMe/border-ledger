import NativeBudget from '../../native/specs/NativeBudget';
import NativeSession from '../../native/specs/NativeSession';
export const nativeBudgetService={
 readSettings:()=>NativeBudget.readSettings(),
 readModeView:(month:string,mode:string)=>NativeBudget.readModeView({month,mode}),
 readCopyPreview:(month:string)=>NativeBudget.readCopyPreview({month}),
 readRolloverPreview:(category:string,month:string,policy:string)=>NativeBudget.readRolloverPreview({category,effectiveMonth:month,policy}),
 startWrite:(id:string,action:string,body:string)=>NativeBudget.startWrite(id,action,body),
 readOperations:(offset:number,limit:number)=>NativeSession.readOperations({offset,limit}),
 queryOperation:(operationId:string)=>NativeSession.queryOperation({operationId}),
};
export type BudgetService=typeof nativeBudgetService;
