import { LedgerAccessError } from './tenant-context';
import type { D1Database } from './db-types';
import { MobileAuthError, now, type MobileAuthConfig, type OwnerContext } from './mobile-auth';
import { assertFinancialAuthority, financialAuthorityGuard, immutableFinancialContext } from './financial-authority';
import { devicePublicationGuard } from './device-publication';

function bindingError() {
  return new MobileAuthError('device_required','An active installation-bound owner session is required.',403);
}

interface StoredBinding {
  device_id:string|null;
  installation_id:string|null;
  status:string|null;
  revoked_at:string|null;
}
function assertStoredDevice(binding:StoredBinding) {
  if(!binding.device_id) {
    if(!binding.installation_id)throw bindingError();
    return;
  }
  if(binding.status!=='paired')throw bindingError();
  if(binding.revoked_at!==null)throw bindingError();
}
async function assertBindingAuthority(db:D1Database,owner:OwnerContext) {
  try {await assertFinancialAuthority(db,owner,'devices:manage');} catch(error) {
    if(error instanceof LedgerAccessError)throw bindingError();
    throw error;
  }
}
async function readBinding(db:D1Database, owner:OwnerContext) {
  await assertBindingAuthority(db,owner);
  const row=await db.prepare(`SELECT f.device_id,f.installation_id,d.status,d.revoked_at FROM owner_session_families f
    LEFT JOIN mobile_devices d ON d.id=f.device_id AND d.ledger_id=f.ledger_id
    WHERE f.id=? AND f.ledger_id=?`).bind(owner.familyId,owner.ledgerId).first<StoredBinding>();
  if(!row)throw bindingError();
  if(owner.deviceId!==null && owner.deviceId!==row.device_id)throw bindingError();
  assertStoredDevice(row);
  return row;
}

/** Statements join the final consent/config/credential batch; no provisional device is published. */
export async function prepareConsentedCaptureDevice(db:D1Database, input:OwnerContext & {consent:true}, config:MobileAuthConfig) {
  const owner=immutableFinancialContext(input);
  if(input.consent!==true)throw bindingError();
  const binding=await readBinding(db,owner);
  const deviceId=binding.device_id??crypto.randomUUID();
  const sameBinding=binding.device_id===null?'device_id IS NULL AND installation_id=?':'device_id=?';
  const guard=devicePublicationGuard(db,owner,`EXISTS (SELECT 1 FROM owner_session_families WHERE id=? AND ledger_id=? AND ${sameBinding})`,[owner.familyId,owner.ledgerId,binding.device_id??binding.installation_id]);
  const statements=[financialAuthorityGuard(db,owner,'devices:manage'),guard];
  if(binding.device_id) {
    statements.push(devicePublicationGuard(db,owner,"EXISTS (SELECT 1 FROM mobile_devices WHERE id=? AND ledger_id=? AND status='paired' AND revoked_at IS NULL)",[deviceId,owner.ledgerId]));
  } else {
    statements.push(db.prepare(`INSERT INTO mobile_devices(id,ledger_id,device_name,platform,status,paired_at)
      VALUES (?,?,'Border Ledger Android','android','paired',?)`).bind(deviceId,owner.ledgerId,now(config).toISOString()));
    statements.push(db.prepare('UPDATE owner_session_families SET device_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ledger_id=?').bind(deviceId,owner.familyId,owner.ledgerId));
  }
  return {deviceId,newDevice:binding.device_id===null,statements};
}

/** Concurrent consent can reuse the already committed winner, after full revalidation. */
export async function bindConsentedCaptureDevice(db:D1Database,input:OwnerContext & {consent:true},config:MobileAuthConfig) {
  const owner=immutableFinancialContext(input);
  const plan=await prepareConsentedCaptureDevice(db,input,config);
  try {await db.batch(plan.statements);} catch(error) {
    const winner=await readBinding(db,owner);
    if(!plan.newDevice || !winner.device_id)throw error;
  }
  const binding=await readBinding(db,owner);
  if(!binding.device_id)throw bindingError();
  await assertFinancialAuthority(db,owner,'devices:manage');
  return binding.device_id;
}
