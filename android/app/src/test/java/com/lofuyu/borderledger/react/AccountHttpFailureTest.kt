package com.lofuyu.borderledger.react

import com.lofuyu.borderledger.accounts.AccountRequestRejected
import com.lofuyu.borderledger.accounts.UrlConnectionAccountHttpTransport
import com.lofuyu.borderledger.api.TransportFailure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountHttpFailureTest {
    @Test fun onlyWorkerConfirmedNonRetryableClientErrorsBecomeDefinitiveRejections() {
        val transport = UrlConnectionAccountHttpTransport()
        assertEquals(409, (transport.classifyFailure(409, "{\"retryable\":false}") as AccountRequestRejected).statusCode)
        assertTrue(transport.classifyFailure(409, "{\"retryable\":true}") is TransportFailure.Retryable)
        assertTrue(transport.classifyFailure(409, null) is TransportFailure.Retryable)
        assertTrue(transport.classifyFailure(401, "{\"retryable\":false}") is TransportFailure.Unauthorized)
        assertTrue(transport.classifyFailure(503, "{\"retryable\":false}") is TransportFailure.Retryable)
    }
}
