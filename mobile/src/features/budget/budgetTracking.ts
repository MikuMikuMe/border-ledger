export type BudgetMode='envelope'|'tracking';
export type Direction='income'|'expense';
export type RolloverPolicy='carry_all'|'carry_positive'|'reset';
export type Plan={month:string;direction:Direction;category:string;plannedMinor:number};
export type TrackingCategory={direction:Direction;category:string;plannedMinor:number;actualMinor:number|null;varianceMinor:number|null;missingTransactionIds:string[]};
export type TrackingData={mode:'tracking';settings:{currency:string;startMonth:string;preferredMode:BudgetMode;revision:number};summary:{month:string;plannedIncomeMinor:number;plannedExpenseMinor:number;plannedSavingsMinor:number;actualIncomeMinor:number|null;actualExpenseMinor:number|null;actualSavingsMinor:number|null;categories:TrackingCategory[]};plans:Plan[];activity:{id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null;kind:'income'|'expense'|'fee'|'refund'}[];currentMonth:string;asOf:string};
export type CopyPreview={month:string;sourceMonth:string;revision:number;sourceRevision:number;plans:Plan[]};
export type RolloverPreview={category:string;effectiveMonth:string;policy:RolloverPolicy;revision:number;changes:{month:string;category:string;beforeOpeningMinor:number|null;afterOpeningMinor:number|null;beforeClosingMinor:number|null;afterClosingMinor:number|null}[]};
