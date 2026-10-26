package com.lofuyu.borderledger.accounts

import com.lofuyu.borderledger.auth.LedgerIdentity
import com.lofuyu.borderledger.auth.SessionBinding
import com.lofuyu.borderledger.core.SecureRecordPort
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class LunchFlowHandoffTest {
    @Test fun canonicalCallbacksAreResultOnlyAndRejectSpoofs() {
        val links=LunchFlowLinks("https://pf.example")
        links.callback("https://pf.example/android/lunchflow/callback?result=connected")
        links.callback("https://pf.example/android/lunchflow/callback?result=failed")
        val invalid=listOf("http://pf.example", "https://evil.example", "https://pf.example:443", "https://user@pf.example")
            .map { "$it/android/lunchflow/callback?result=connected" } + listOf(
            "https://pf.example/android/auth/callback?result=connected",
            "https://pf.example/android/lunchflow/%63allback?result=connected",
            "https://pf.example/android/lunchflow/callback?result=connected&result=failed",
            "https://pf.example/android/lunchflow/callback?result=connected&code=secret",
            "https://pf.example/android/lunchflow/callback?result=unknown",
            "https://pf.example/android/lunchflow/callback?result=connected#fragment",
        )
        invalid.forEach { value -> assertTrue(runCatching { links.callback(value) }.isFailure) }
    }
    @Test fun launchIsCanonicalAndNeverStoredWithThePendingBinding()=runTest {
        val f=Fixture();f.handoff().start()
        assertEquals(1,f.opened)
        val stored=f.records.values.values.single().decodeToString()
        assertTrue(stored.contains("epoch-a"));assertFalse(stored.contains("ticket"));assertFalse(stored.contains("secret"))
        assertFalse(stored.contains("https://"))
    }
    @Test fun recreationConsumesPendingAndReadsAuthenticatedStatusEvenForFailedHint()=runTest {
        val f=Fixture();f.handoff().start();f.value=f.value.copy(connected=true,generation=3)
        assertTrue(f.handoff().callback(f.failed)!!.connected)
        assertTrue(f.records.values.isEmpty())
        val reads=f.reads
        f.handoff().callback(f.failed)
        assertEquals(reads+1,f.reads) // Replay can refresh, never manufacture a connection.
    }
    @Test fun spoofedSuccessWithoutPendingReturnsOnlyActualDisconnectedStatus()=runTest {
        val f=Fixture();val result=f.handoff().callback(f.success)
        assertFalse(result!!.connected);assertEquals(0,f.opened)
    }
    @Test fun logoutAndAccountSwitchCannotCompleteOldPendingHandoff()=runTest {
        val f=Fixture();f.handoff().start();f.owner=null
        assertNull(f.handoff().callback(f.success))
        f.owner=SessionBinding(LedgerIdentity("b","ledger-b"),"epoch-b")
        val reads=f.reads
        assertNull(f.handoff().callback(f.success));assertEquals(reads,f.reads)
        assertTrue(f.records.values.isEmpty())
    }
    @Test fun replacementGenerationAndDifferentConnectionDoNotCompletePendingFlow()=runTest {
        for(replacement in listOf(connection().copy(generation=5),connection().copy(connectionId="other"))){
            val f=Fixture();f.handoff().start();f.value=replacement
            assertNull(f.handoff().callback(f.success))
        }
    }
    @Test fun cancelExpiryAndNoBrowserAreSafeWithoutAnActivity()=runTest {
        val f=Fixture();f.handoff().start();f.handoff().cancel();assertTrue(f.records.values.isEmpty())
        assertFalse(f.handoff().callback(f.success)!!.connected)
        f.handoff().start();f.clock=1000;assertNull(f.handoff().callback(f.success))
        f.failOpen=true;assertTrue(runCatching { f.handoff().start() }.isFailure);assertTrue(f.records.values.isEmpty())
    }
    @Test fun statusCompletingAfterOwnerSwitchCannotBePublished()=runTest {
        val f=Fixture();val entered=CompletableDeferred<Unit>();val gate=CompletableDeferred<Unit>()
        val handoff=f.handoff { entered.complete(Unit);gate.await();f.value }
        val pending=async { runCatching { handoff.connection() } };entered.await()
        f.owner=SessionBinding(LedgerIdentity("b","ledger-b"),"epoch-b");gate.complete(Unit)
        assertTrue(pending.await().isFailure)
    }
}
private fun connection()=LunchFlowConnection("a","ledger-a","lf",2,"platform",true,false,false,true,"not_requested","disconnected",false)
private class Records:SecureRecordPort {
    val values=mutableMapOf<String,ByteArray>()
    override suspend fun read(record:String)=values[record]
    override suspend fun write(record:String,value:ByteArray){values[record]=value}
    override suspend fun delete(record:String){values.remove(record)}
}
private class Fixture {
    val records=Records();var owner:SessionBinding?=SessionBinding(LedgerIdentity("a","ledger-a"),"epoch-a")
    var value=connection();var reads=0;var opened=0;var clock=0L;var failOpen=false
    val success="https://pf.example/android/lunchflow/callback?result=connected"
    val failed="https://pf.example/android/lunchflow/callback?result=failed"
    fun handoff(read:suspend ()->LunchFlowConnection={reads++;value})=LunchFlowHandoff(records,{owner},read,
        {LunchFlowLaunch("https://pf.example/api/lunchflow/oauth/launch?ticket="+"s".repeat(30),"lf")},
        {if(failOpen)error("no browser");opened++},LunchFlowLinks("https://pf.example"),{clock})
}
