import {createContext} from 'react';
import type NativeLedger from '../../native/specs/NativeLedger';
export type CategoryServices=Pick<typeof NativeLedger,'readCategories'|'createCategory'|'categoryAction'|'readReport'|'readTransactions'>;
const unavailable=async():Promise<never>=>{throw new Error('Category service unavailable');};
export const CategoryServicesContext=createContext<CategoryServices>({readCategories:unavailable,createCategory:unavailable,categoryAction:unavailable,readReport:unavailable,readTransactions:unavailable});
