package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.accounts.AccountRequestRejected
import com.lofuyu.borderledger.accounts.accountHttpFailure
import com.lofuyu.borderledger.api.TransportFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountHttpFailureTest {
    @Test fun onlyWorkerConfirmedNonRetryableClientErrorsBecomeDefinitiveRejections() {
        assertEquals(409, (accountHttpFailure(409, "{\"retryable\":false}") as AccountRequestRejected).statusCode)
        assertTrue(accountHttpFailure(409, "{\"retryable\":true}") is TransportFailure.Retryable)
        assertTrue(accountHttpFailure(409, null) is TransportFailure.Retryable)
        assertTrue(accountHttpFailure(401, "{\"retryable\":false}") is TransportFailure.Unauthorized)
        assertTrue(accountHttpFailure(503, "{\"retryable\":false}") is TransportFailure.Retryable)
    }
}
