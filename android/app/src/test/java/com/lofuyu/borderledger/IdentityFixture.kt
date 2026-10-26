package com.lofuyu.borderledger

import com.lofuyu.borderledger.auth.*

/** Explicit synthetic identity: production never falls back to this owner. */
class IdentityFixture(user: String = "owner", ledger: String = "personal", epoch: String = "test-session") {
    var binding: SessionBinding? = SessionBinding(LedgerIdentity(user, ledger), epoch)
    var credential: CaptureCredentialRecord? = CaptureCredentialRecord(
        "capture-$user", "device-$user", 1, "2200-01-01T00:00:00Z", "revoke-$user", binding!!.identity, epoch,
    )
    val credentials = object : CaptureCredentialProvider {
        override suspend fun current() = credential
        override suspend fun save(value: CaptureCredentialRecord) { credential = value }
        override suspend fun clear() { credential = null }
    }
    val boundary = CaptureWorkBoundary(credentials, owner = { binding })
}

fun ownerCredentials(token: String): OwnerCredentialProvider = object : OwnerCredentialProvider {
    private val binding = SessionBinding(LedgerIdentity("owner", "personal"), "test-session")
    override fun currentBinding() = binding
    override suspend fun accessToken() = token
    override suspend fun accessTokenFor(expected: SessionBinding) = token.takeIf { expected == binding }
}
