/** DOM/RN-free DTO projections, structurally checked against Codegen in DetailsScreen. */
import type {Stream,Operation,Money} from '../finance/contracts';
export type History={providerTransactionId:string;pendingProviderTransactionId:string|null;date:string;amountMinor:string;currency:string;status:string;kind:string};
export type Detail={stream:Stream;history:History[];nextCursor:string|null;limit:number;classification:string};
export type Annotation={transactionId:string;expectedRevision:number;category:string;note:string|null};
export type Decision={eventId:string;expectedRevision:number;decision:string;targetId:string|null;candidateTransactionId:string|null;relation:string|null;allocatedMoney:Money|null};
export type Alert={eventId:string;eventType:string;state:string;countedMoney:Money|null;reportingDate:string|null;revision:number;reasonCodes:string[];sourceEvidence:{sourceProfileId:string;parserVersion:string;eventTimeBasis:string;capturedAt:string;notificationPostedAt:string|null;bankReference:string|null;merchant:string|null;eventMoney:Money|null}|null;provenance:{sourceKind:string;sourceId:string;basis:string;revision:number}[];affectedMoney:Money|null;candidates:{id:string;statementTransactionId:string;candidateTransactionId:string;score:number;reasonCodes:string[];status:string;evidenceBasis:string;relation:string|null;targetTransaction:{id:string;date:string;merchant:string;amountMinor:string;currency:string;kind:string;status:string;source:string}}[];links:{id:string;targetEventId:string|null;targetTransactionId:string|null;relation:string;allocatedMoney:Money|null;evidenceBasis:string;revision:number}[];linkAction:{targetId:string;candidateTransactionId:string;relation:string;allocatedMoney:Money|null}|null;linkDisabledReason:string|null;transactionId:string|null;annotation:Annotation|null;annotationDisabledReason:string|null};
export type ReviewPage={items:Alert[];nextCursor:string|null;limit:number};
export type Account={providerAccountId:string;name:string;mask:string|null;subtype:string|null;currency:string;kind:string};
export type AccountPage={accounts:Account[];nextCursor:string|null;limit:number};
export type Connection={connectionId:string;institution:string|null;state:string;expiresAt:string|null;cleanupState:string|null;lastSyncedAt:string|null;lastError:string|null};
export type LinkSnapshot={state:string;outcomeCode:string|null;operationId:string|null;canCancel:boolean;pendingConnectionId:string|null;connectionId:string|null;accounts:Account[]};
export type LunchFlowAccountKind='chequing'|'savings'|'credit';
export type LunchFlowAccount={providerAccountId:string;name:string;institution:string;currencies:string[];selected:boolean;accountId:string|null;kind:LunchFlowAccountKind|null;currency:string|null;lastSyncedAt:string|null;lastError:string|null};
export type LunchFlowAccounts={configured:boolean;accounts:LunchFlowAccount[]};
export type LunchFlowSelection={providerAccountId:string;currency:string;kind:LunchFlowAccountKind};
export type AccountsData={page:AccountPage;connections:Connection[];link:LinkSnapshot;lunchFlow?:LunchFlowAccounts};
type Subscription={remove():void};
export type DetailsPorts={
  recurring:{readDetail(id:string,cursor:string|null,limit:number):Promise<Detail>;startClassify(op:string,id:string,revision:number,classification:string):Promise<Operation>;onChanged(cb:()=>void):Subscription};
  review:{readAlerts(cursor:string|null,limit:number):Promise<ReviewPage>;startReview(op:string,value:Decision):Promise<Operation>;startAnnotate(op:string,value:Annotation):Promise<Operation>;onChanged(cb:()=>void):Subscription};
  accounts:{getSnapshot():Promise<LinkSnapshot>;readAccounts(cursor:string|null,limit:number):Promise<AccountPage>;readConnections():Promise<Connection[]>;readLunchFlowAccounts?():Promise<LunchFlowAccounts>;readLunchFlowStatus?():Promise<LunchFlowAccounts>;startConnect(op:string,reconnect:string|null):Promise<Operation>;cancelConnect(op:string):Promise<Operation>;startSelectAccounts(op:string,pending:string,ids:string[]):Promise<Operation>;startCancelPending(op:string,pending:string):Promise<Operation>;startSync(op:string):Promise<Operation>;startDisconnect(op:string,id:string):Promise<Operation>;startLunchFlowAccountSelection?(op:string,accounts:LunchFlowSelection[]):Promise<Operation>;startLunchFlowSync?(op:string):Promise<Operation>;onStateChanged(cb:(value:LinkSnapshot)=>void):Subscription};
  refreshLedger?():Promise<unknown>;
  session:{readOperations(offset:number,limit:number):Promise<Operation[]>;queryOperation(id:string):Promise<Operation|null>};
};
