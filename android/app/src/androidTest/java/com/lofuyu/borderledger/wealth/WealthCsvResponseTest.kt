package com.lofuyu.borderledger.wealth

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.local.AndroidKeyStoreVault
import com.lofuyu.borderledger.local.FileEncryptedRecordStore
import com.lofuyu.borderledger.local.SecureStorageException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class WealthCsvResponseTest {
    @Test
    fun expandedPreviewResponseSurvivesTransportAndEncryptedReopen() = runBlocking {
        val response = fetchResponse("POST", "$WEALTH_ROOT/imports/preview")
        assertEquals(200, response.statusCode)
        assertEquals(3 * 1024 * 1024, response.body.length)
        assertStoredRoundTrip("rn_wealth_preview_v1_" + "a".repeat(64), response.body.encodeToByteArray())
    }

    @Test
    fun ordinaryResponsesKeepTheirSmallerLimit() {
        assertThrows(TransportFailure.Unavailable::class.java) {
            runBlocking { fetchResponse("GET", "$WEALTH_ROOT/report") }
        }
    }

    @Test
    fun ordinaryRecordsKeepTheirSmallerLimit() {
        assertThrows(SecureStorageException::class.java) {
            runBlocking { records().write("ordinary_csv_boundary", ByteArray(3 * 1024 * 1024)) }
        }
    }

    @Test
    fun previewEncryptionCanReopenAtThePlaintextLimit() = runBlocking {
        assertStoredRoundTrip("rn_wealth_preview_v1_" + "b".repeat(64), ByteArray(32 * 1024 * 1024) { 42 })
    }

    @Test
    fun previewRecordsStillRejectUnboundedData() {
        assertThrows(SecureStorageException::class.java) {
            runBlocking { records().write("rn_wealth_preview_v1_too_large", ByteArray(32 * 1024 * 1024 + 1)) }
        }
    }

    @Test
    fun fullSizePreviewResponsesRemainReadable() = runBlocking {
        val response = fetchResponse("POST", "$WEALTH_ROOT/imports/preview", 32 * 1024 * 1024)
        assertEquals(32 * 1024 * 1024, response.body.length)
    }

    @Test
    fun oversizedPreviewResponsesRemainRejected() {
        assertThrows(TransportFailure.Unavailable::class.java) {
            runBlocking { fetchResponse("POST", "$WEALTH_ROOT/imports/preview", 32 * 1024 * 1024 + 1) }
        }
    }
    @Test
    fun fullSizeSourceCsvSurvivesItsRealHashedRecordName() = runBlocking {
        assertStoredRoundTrip("rn_wealth_csv_source_v1_" + "d".repeat(64), ByteArray(2 * 1024 * 1024) { 42 })
    }
    private suspend fun assertStoredRoundTrip(key: String, value: ByteArray) {
        try {
            records().write(key, value)
            assertArrayEquals(value, records().read(key))
        } finally {
            records().delete(key)
        }
    }

    private fun records() = FileEncryptedRecordStore(
        InstrumentationRegistry.getInstrumentation().targetContext,
        AndroidKeyStoreVault(),
        "wealth-csv-boundary-tests",
    )

    private suspend fun fetchResponse(method: String, path: String, bodyBytes: Int = 3 * 1024 * 1024): WealthHttpResponse {
        val body = "x".repeat(bodyBytes).encodeToByteArray()
        return ServerSocket(0).use { server ->
            val responder = thread(isDaemon = true) { respond(server, body) }
            try {
                UrlWealthHttpTransport().execute(MobileRequest(method, "http://127.0.0.1:${server.localPort}$path"))
            } finally {
                server.close()
                responder.join(5000)
            }
        }
    }

    private fun respond(server: ServerSocket, body: ByteArray) {
        try {
            server.accept().use { socket -> writeResponse(socket, body) }
        } catch (_: IOException) {
            // The client closes early when its response-size guard rejects the body.
        }
    }

    private fun writeResponse(socket: Socket, body: ByteArray) {
        val input = socket.getInputStream().bufferedReader()
        while (!input.readLine().isNullOrEmpty()) Unit
        socket.getOutputStream().use { output ->
            output.write("HTTP/1.1 200 OK\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".encodeToByteArray())
            output.write(body)
        }
    }
}
