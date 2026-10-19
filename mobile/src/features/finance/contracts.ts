/** DOM/RN-free screen contracts. The typed native adapter is checked structurally in FinanceScreen. */
export type Operation={operationId:string;kind:string;status:string;updatedAt:string;resultId:string|null};
export type Reporting={reportingTimezone:string;weekStart:number;preferredCurrency:string|null;revision:number;updatedAt:string|null};
export type Transaction={id:string;occurredAt:string;currency:string;signedMinorUnits:string;merchant:string|null;accountLabel:string|null;status:string;sourceLabel:string|null;category:string|null;note:string|null;kind:string;revision:number;accountId:string|null};
export type Transactions={items:Transaction[];nextCursor:string|null;limit:number};
export type ActivityQuery={cursor:string|null;limit:number;query:string|null;currency:string|null;status:string|null;source:string|null;category:string|null};
export type ReportQuery={startDate:string;endDate:string;includeProvisional:boolean;currency:string|null;reportingCurrency:string|null;timeZone:string};
export type Report={timeBasis:string;currencyTotals:{currency:string;confirmedMinorUnits:string;provisionalMinorUnits:string;confirmedCount:number;provisionalCount:number}[];dailyTotals:{date:string;currency:string;confirmedMinorUnits:string;provisionalMinorUnits:string}[];reviewCount:number;excludedCount:number;from:string|null;to:string|null;includeProvisional:boolean;timeZone:string|null;asOf:string|null;sourceCoverage:{source:string;count:number}[];reportingCurrency:string|null;convertedTotals:{confirmedMinorUnits:string;provisionalMinorUnits:string;confirmedCount:number;provisionalCount:number}|null;convertedDailyTotals:{date:string;confirmedMinorUnits:string;provisionalMinorUnits:string}[];fx:{provider:string;complete:boolean;unavailableSourceCurrencies:string[];lockedDateCount:number;earliest:string|null;latest:string|null;chineseBankBand:{eligible:boolean;currency:string;baseMinorUnits:string;lowerMinorUnits:string;upperMinorUnits:string;percentageBasisPoints:number}|null}};
export type Snapshot={schemaVersion:number;snapshotAt:string;timeZone:string;accounts:{id:string;displayName:string;institution:string|null;instrument:string|null;currencies:string[];lastSuccessfulSyncAt:string|null}[];transactions:Transaction[];recurring:{id:string;label:string;currency:string;monthlyMinorUnits:string|null;classification:string|null;nextDueAt:string|null}[];reviews:{id:string;reason:string;currency:string|null;affectedMinorUnits:string|null;candidateLabel:string|null;status:string}[];report:Report|null};
export type Stream={id:string;accountId:string;currency:string;merchantName:string|null;merchantEntityId:string|null;frequency:string;sourceFrequency:string|null;classification:string;sourceStatus:string;isOutflow:boolean;firstDate:string|null;lastDate:string|null;averageAmountMinor:string|null;lastAmountMinor:string|null;predictedAmountMinor:string|null;predictedNextDate:string|null;sourceUpdatedAt:string|null;revision:number};
export type RecurringQuery={cursor:string|null;limit:number;currency:string|null;classification:string|null};
export type Page={items:Stream[];nextCursor:string|null;limit:number;state:string;checkedAt:string|null;sourceUpdatedAt:string|null;lastError:string|null;coverageWarnings:string[]};
export type Money={currency:string;amountMinor:string};
export type Summary={monthlyByCurrency:Money[];yearlyByCurrency:Money[];subscriptionByCurrency:Money[];actualCostByCurrency:Money[];upcoming:{stream:Stream;nextExpectedAmountMinor:string|null}[];latestPaymentChanges:Stream[];streamCount:number;coverageWarnings:string[];checkedAt:string|null;sourceUpdatedAt:string|null;lastError:string|null;state:string};
export type Lens={window:'Today'|'Week'|'Month';include:boolean;source:string|null;target:string|null};
export type RecurringData={page:Page;summary:Summary|null};
export type MutationState={blocked:boolean;status:string};
type EventPort={onChanged(listener:()=>void):{remove():void}};
export type FinancePorts={
  ledger:EventPort&{getSnapshot():Promise<Snapshot|null>;refreshSnapshot():Promise<Snapshot|null>;readReport(query:ReportQuery):Promise<Report>;readTransactions(query:ActivityQuery):Promise<Transactions>};
  recurring:EventPort&{readPage(query:RecurringQuery):Promise<Page>;readSummary(start:string,end:string):Promise<Summary>;startClassify(op:string,id:string,revision:number,classification:string):Promise<Operation>};
  preferences:{readReporting():Promise<Reporting>};
  review:{startAnnotate(op:string,value:{transactionId:string;expectedRevision:number;category:string;note:string|null}):Promise<Operation>};
  session:{readOperations(offset:number,limit:number):Promise<Operation[]>;queryOperation(id:string):Promise<Operation|null>};
};
