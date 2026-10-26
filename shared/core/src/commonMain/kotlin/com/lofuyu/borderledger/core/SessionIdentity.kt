package com.lofuyu.borderledger.auth

import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/** Public server-approved identity; never a credential or caller authorization selector. */
data class LedgerIdentity(val userId: String, val ledgerId: String) {
    init { require(userId.isNotBlank() && ledgerId.isNotBlank()) }
}
data class SessionBinding(val identity: LedgerIdentity, val epoch: String) {
    init { require(epoch.isNotBlank()) }
}
class OwnerWork(val binding: SessionBinding) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<OwnerWork>
}
fun OwnerSessionStateProvider.binding(): SessionBinding? = (state.value as? OwnerSessionState.SignedIn)?.binding
