import type {BudgetCategorySummary} from '../domain/budget-summary';

export type BudgetMode='envelope'|'tracking';
export type RolloverPolicy='carry_all'|'carry_positive'|'reset';
export type BudgetSettings={currency:string;preferredMode?:BudgetMode;revision?:number};
export type Account={id:string;name:string;currency:string};
export type Balance={id:string;accountId?:string;name:string;source:'manual'|'lunchflow'|'unavailable'|'excluded';sourceCurrency:string;sourceMinor:number|null;amountMinor:number|null;observedAt:string|null;rateDate:string|null;rate?:string|null};
export type BudgetSnapshot={settings:BudgetSettings|null;cash:{id:string;name:string;currency:string;amountMinor:number;accountId?:string}[]};
export type SuggestedCategory=BudgetCategorySummary & {suggestionBasis?:'target'|'history'|null};
export type BudgetActivity={id:string;date:string;category:string;sourceCurrency:string;sourceMinor:number;activityMinor:number|null;rateDate:string|null;rate:string|null;kind?:string};
type CommonView={settings:BudgetSettings;currentMonth:string;activity:BudgetActivity[];asOf:string};
export type BudgetViewData=CommonView & {mode?:'envelope';startMonth:string;summary:{month:string;cashMinor:number|null;unassignedMinor:number|null;categories:SuggestedCategory[]};balances:Balance[];rolloverPolicies?:{category:string;effectiveMonth:string;policy:RolloverPolicy}[]};
export type TrackingPlan={month:string;direction:'income'|'expense';category:string;plannedMinor:number};
export type TrackingCategory={direction:'income'|'expense';category:string;plannedMinor:number;actualMinor:number|null;varianceMinor:number|null;missingTransactionIds:string[]};
export type TrackingViewData=CommonView & {mode:'tracking';plans:TrackingPlan[];summary:{month:string;plannedIncomeMinor:number;plannedExpenseMinor:number;plannedSavingsMinor:number;actualIncomeMinor:number|null;actualExpenseMinor:number|null;actualSavingsMinor:number|null;categories:TrackingCategory[]}};
export type CopyPreview={month:string;sourceMonth:string;revision:number;sourceRevision:number;plans:TrackingPlan[]};
export type RolloverPreview={category:string;effectiveMonth:string;policy:RolloverPolicy;revision:number;changes:{month:string;category:string;beforeOpeningMinor:number|null;afterOpeningMinor:number|null;beforeClosingMinor:number|null;afterClosingMinor:number|null}[]};
