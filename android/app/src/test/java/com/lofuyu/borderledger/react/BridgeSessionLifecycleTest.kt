package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.auth.*
import com.lofuyu.borderledger.api.*
import com.lofuyu.borderledger.core.*
import com.lofuyu.borderledger.local.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BridgeSessionLifecycleTest {
    @Test fun initialSnapshotAndResumeEventsUseTheSharedSessionAndNeverExposeTokens()=runTest {
        val fixture=Fixture()
        val bridge=BridgeSessionLifecycle(fixture.manager)
        val seen=mutableListOf<Map<String,Any?>>()
        val collector=backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { bridge.snapshots.collect { seen.add(it) } }
        assertEquals("signed_in",bridge.getSnapshot()["state"])
        fixture.valid=false
        val gate=CompletableDeferred<Unit>(); fixture.refreshGate=gate
        val requests=List(8) { async { bridge.resume() } }
        runCurrent()
        assertEquals(1,fixture.refreshes)
        assertTrue(requests.all { !it.isCompleted })
        fixture.valid=true; gate.complete(Unit)
        assertTrue(requests.awaitAll().all { it["state"]=="signed_in" })
        assertEquals(1,fixture.refreshes)
        assertTrue(seen.any { it["state"]=="refreshing" })
        assertFalse(seen.toString().contains("native-secret"))
        collector.cancel()
    }

    @Test fun signOutFencesBeforeNativeCleanupAndRecreationReturnsSignedOut()=runTest {
        val fixture=Fixture(); var fenced=false
        val bridge=BridgeSessionLifecycle(fixture.manager) { assertNotNull(fixture.session); fenced=true }
        bridge.getSnapshot()
        val result=bridge.signOut()
        assertTrue(fenced)
        assertNull(fixture.session)
        assertEquals("signed_out",result["state"])
        assertEquals("signed_out",BridgeSessionLifecycle(fixture.newManager()).getSnapshot()["state"])
    }

    private class Fixture: OwnerSessionStore, OwnerLoginClient, CaptureCredentialProvider, LocalDataPolicy, CoreClock, CoreCrypto {
        var session: OwnerSessionRecord?=OwnerSessionRecord("native-secret-access","native-secret-refresh","future",listOf("owner"),1,"native-secret-revoke","device", identity = com.lofuyu.borderledger.auth.LedgerIdentity("owner", "personal"), epoch = "test-session")
        var valid=true
        var refreshes=0
        var refreshGate: CompletableDeferred<Unit>?=null
        var rotation: PendingOwnerRotation?=null
        val manager=newManager()
        fun newManager()=OwnerSessionCore(this,this,this,this,"https://example.test/callback","sandbox","device",this,this)
        override fun nowIso()="2026-10-16T00:00:00Z"
        override fun isAfterNow(iso: String)=valid
        override fun randomToken(byteCount: Int)="native-secret-random"
        override fun sha256Hex(value: String)="digest"
        override fun pkceChallenge(verifier: String)="native-secret-challenge"
        override suspend fun readSession()=session
        override suspend fun writeSession(value: OwnerSessionRecord) { session=value }
        override suspend fun clearSession() { session=null }
        override suspend fun readPendingLogin(): PendingOwnerLogin?=null
        override suspend fun writePendingLogin(value: PendingOwnerLogin) { }
        override suspend fun clearPendingLogin() { }
        override suspend fun readPendingRotation()=rotation
        override suspend fun writePendingRotation(value: PendingOwnerRotation) { rotation=value }
        override suspend fun clearPendingRotation() { rotation=null }
        override suspend fun readCompletedCallback(): CompletedCallbackMarker?=null
        override suspend fun writeCompletedCallback(value: CompletedCallbackMarker) { }
        override suspend fun readPendingRevocations()=emptyList<RevocationIntent>()
        override suspend fun writePendingRevocations(values: List<RevocationIntent>) { }
        override suspend fun current(): CaptureCredentialRecord?=null
        override suspend fun save(value: CaptureCredentialRecord) { }
        override suspend fun clear() { }
        override suspend fun pauseMonitoring() { }
        override suspend fun clearOwnerReadCache() { }
        override suspend fun retainEncryptedOutbox() { }
        override suspend fun queueRevocation(value: RevocationIntent) { }
        override suspend fun pendingRevocationCount()=0
        override suspend fun startLogin(input: OwnerLoginStartRequest)=error("Not called")
        override suspend fun exchangeCode(input: OwnerCodeExchangeRequest)=error("Not called")
        override suspend fun refresh(input: OwnerRefreshRequest): OwnerTokenResponse { refreshes++; refreshGate?.await(); return OwnerTokenResponse("native-secret-new-access","native-secret-new-refresh","future",listOf("owner"),2,"native-secret-new-revoke", userId = "owner", ledgerId = "personal") }
        override suspend fun logout(accessToken: String) { }
        override suspend fun revoke(intent: RevocationIntent) { }
    }
}
