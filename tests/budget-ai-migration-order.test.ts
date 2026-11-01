import {afterEach,describe,expect,it} from 'vitest';
import {createD1Fixture,task24MigrationNames,applyMigrations} from './helpers/d1';
import type {D1Database} from '../worker/db-types';
import {configureBudget,setBudgetAllocation,readBudgetSettings,readBudgetAllocations} from '../worker/budget-store';
import {saveBudgetTarget,saveManualCash,listBudgetTargets,listManualCash} from '../worker/budget-inputs';
import {readBudgetState,saveBudgetMode,saveTrackingPlan,readTrackingPlans} from '../worker/budget-planning-store';
import {saveAiConfiguration,listAiConfigurations} from '../worker/ai-store';
import {openAiCredential,type AiProvider,type SealedAiCredential} from '../worker/ai-crypto';

const owner={userId:'owner',ledgerId:'personal'};
const options={secret:'ab'.repeat(32),appOrigin:'https://ledger.example'};
const tracking='0031-budget-tracking.sql',official='0032-ai-official-providers.sql';
const base=[...task24MigrationNames,'0025-lunchflow-platform.sql','0026-lunchflow-connection-mappings.sql','0027-hosted-users-activation.sql','0028-recurring-plans.sql','0029-budget.sql','0030-ai-settings.sql'];
const fixtures:Array<{dispose():Promise<void>}>=[];
afterEach(async()=>{for(const fixture of fixtures.splice(0))await fixture.dispose();});

async function saveProvider(db:D1Database,provider:AiProvider) {
 const endpoints={openai:'https://api.openai.com/v1/chat/completions',anthropic:'https://api.anthropic.com/v1/messages',deepseek:'https://api.deepseek.com/chat/completions'};
 await saveAiConfiguration(db,owner,{provider,endpoint:endpoints[provider],model:'test',credential:provider+'-synthetic-key'},options);
}
async function budgetSnapshot(db:D1Database) {
 return {settings:await readBudgetSettings(db,owner),allocations:await readBudgetAllocations(db,owner),targets:await listBudgetTargets(db,owner),cash:await listManualCash(db,owner)};
}
async function seedBudget(db:D1Database) {
 await configureBudget(db,owner,'CAD','2026-10');
 await setBudgetAllocation(db,owner,{month:'2026-10',category:'Food',assignedMinor:100});
 await saveBudgetTarget(db,owner,{category:'Food',targetMinor:200});
 await saveManualCash(db,owner,{id:'cash',name:'Cash',currency:'CAD',amountMinor:500});
}
async function credentialRows(db:D1Database) {
 return (await db.prepare('SELECT * FROM ai_credentials WHERE ledger_id=? AND user_id=? ORDER BY provider').bind(owner.ledgerId,owner.userId).all<SealedAiCredential & {provider:AiProvider}>()).results;
}
async function migrateAndWrite(db:D1Database,name:string) {
 await applyMigrations(db,[name]);
 if(name===official){await saveProvider(db,'deepseek');return;}
 await saveBudgetMode(db,owner,{mode:'tracking',expectedRevision:0,operationId:'mode'});
 await saveTrackingPlan(db,owner,{month:'2026-10',direction:'income',category:'Salary',plannedMinor:1000,expectedRevision:1,operationId:'plan'});
}

describe('tracking and official-provider migration compatibility',()=>{
 it.each([[tracking,official],[official,tracking]])('preserves budgets and encrypted keys when applying %s then %s',async(first,second)=>{
  const fixture=await createD1Fixture(base);fixtures.push(fixture);const {db}=fixture;
  await seedBudget(db);await saveProvider(db,'openai');
  const budgetBefore=await budgetSnapshot(db),keysBefore=await credentialRows(db);
  await migrateAndWrite(db,first);await migrateAndWrite(db,second);
  expect(await budgetSnapshot(db)).toEqual(budgetBefore);
  expect(await readBudgetState(db,owner)).toEqual({preferredMode:'tracking',revision:2});
  expect(await readTrackingPlans(db,owner,'2026-10')).toEqual([{month:'2026-10',direction:'income',category:'Salary',plannedMinor:1000}]);
  const keysAfter=await credentialRows(db);
  expect(keysAfter.filter(row=>row.provider==='openai')).toEqual(keysBefore);
  for(const row of keysAfter)expect(await openAiCredential(row,options.secret,{...owner,provider:row.provider})).toBe(row.provider+'-synthetic-key');
  expect((await listAiConfigurations(db,owner)).map(row=>row.provider)).toEqual(['deepseek','openai']);
  await applyMigrations(db,[tracking,official]);
  expect(await credentialRows(db)).toEqual(keysAfter);
  expect(await readBudgetState(db,owner)).toEqual({preferredMode:'tracking',revision:2});
 },30000);
});
