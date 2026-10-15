package com.lofuyu.borderledger.api

import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

class HttpWorkerOwnerLoginClientTest {
    private val servers = mutableListOf<TestHttpServer>()

    @After
    fun stopServers() {
        servers.forEach { it.stop(0) }
        servers.clear()
    }

    @Test
    fun startLoginParsesJsonAndSendsTheExpectedContract() = runBlocking {
        val server = server(status = 201, body = """
            {"requestId":"request-1","authorizationUrl":"https://access.example/authorize","expiresAt":"2099-01-01T00:00:00Z"}
        """.trimIndent())

        val result = client(server).startLogin(startRequest())

        assertEquals("request-1", result.requestId)
        assertEquals("https://access.example/authorize", result.authorizationUrl)
        assertEquals("POST", server.requestMethod.get())
        assertEquals("application/json; charset=utf-8", server.requestHeaders.get()["content-type"])
        assertTrue(server.requestBody.get().contains("\"codeChallenge\""))
        assertTrue(server.requestBody.get().contains("\"environment\":\"sandbox\""))
    }

    @Test
    fun delayedResponseReturnsOfflineWithinTheConfiguredDeadline() = runBlocking {
        val server = server(
            status = 201,
            body = "{}",
            delayMillis = 500,
        )

        assertThrows<TransportFailure.Offline> {
            client(server, timeoutMillis = 100).startLogin(startRequest())
        }
    }

    @Test
    fun htmlOrMalformedJsonResponseIsRetryable() = runBlocking {
        val server = server(status = 200, body = "<html>Cloudflare Access</html>")

        assertThrows<TransportFailure.Retryable> {
            client(server).startLogin(startRequest())
        }
    }

    @Test
    fun unauthorizedResponsesRequireReauthentication() = runBlocking {
        for (status in listOf(401, 403)) {
            val server = server(status = status, body = "{\"code\":\"unauthorized\"}")

            assertThrows<TransportFailure.Unauthorized> {
                client(server).startLogin(startRequest())
            }
        }
    }

    @Test
    fun emptyTokenFieldFailsClosedAsRetryable() = runBlocking {
        val server = server(
            status = 200,
            body = """
                {"accessToken":"","refreshToken":"refresh","expiresAt":"2099-01-01T00:00:00Z","scopes":["ledger:read"],"revision":1,"revocationCapability":"revoke"}
            """.trimIndent(),
        )

        assertThrows<TransportFailure.Retryable> {
            client(server).exchangeCode(
                OwnerCodeExchangeRequest(
                    requestId = "request-1",
                    code = "code",
                    verifier = "verifier",
                    state = "state",
                    deviceId = "device-1",
                    environment = "sandbox",
                    idempotencyKey = "idempotency-1",
                    staySignedIn = false,
                ),
            )
        }
    }

    @Test
    fun staleRevocationResponseMapsToTheDedicatedFailure() = runBlocking {
        val server = server(status = 409, body = "{\"code\":\"stale_revocation\"}")

        assertThrows<TransportFailure.StaleRevocation> {
            client(server).revoke(
                RevocationIntent(
                    grantType = RevocationGrantType.OwnerFamily,
                    generation = 1,
                    capability = "capability",
                    createdAt = "2099-01-01T00:00:00Z",
                ),
            )
        }
    }

    private fun client(server: TestHttpServer, timeoutMillis: Int = 2_000) = HttpWorkerOwnerLoginClient(
        origin = server.origin,
        environment = "sandbox",
        callbackUrl = "https://pf.example.com/android/auth/callback",
        networkTimeoutMillis = timeoutMillis,
    )

    private fun startRequest() = OwnerLoginStartRequest(
        codeChallenge = "A".repeat(43),
        state = "B".repeat(32),
        deviceId = "device-1",
        environment = "sandbox",
    )

    private fun server(
        status: Int,
        body: String,
        delayMillis: Long = 0,
    ): TestHttpServer {
        val server = TestHttpServer(status, body, delayMillis)
        servers += server
        return server
    }
}

private class TestHttpServer(
    private val status: Int,
    private val responseBody: String,
    private val delayMillis: Long,
) {
    private val socket = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))
    val origin = "http://127.0.0.1:${socket.localPort}"
    val requestMethod = AtomicReference("")
    val requestHeaders = AtomicReference<Map<String, String>>(emptyMap())
    val requestBody = AtomicReference("")
    private val worker = thread(start = true, isDaemon = true, name = "border-ledger-http-test") {
        try {
            socket.accept().use { connection ->
                val input = BufferedInputStream(connection.getInputStream())
                val requestLine = input.readHttpLine() ?: return@use
                requestMethod.set(requestLine.substringBefore(' '))
                val headers = mutableMapOf<String, String>()
                while (true) {
                    val line = input.readHttpLine() ?: return@use
                    if (line.isEmpty()) break
                    val separator = line.indexOf(':')
                    if (separator > 0) headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
                }
                requestHeaders.set(headers)
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                requestBody.set(input.readNBytes(length).toString(Charsets.UTF_8))
                if (delayMillis > 0) Thread.sleep(delayMillis)
                val payload = responseBody.toByteArray(Charsets.UTF_8)
                val response = buildString {
                    append("HTTP/1.1 $status ${statusText(status)}\r\n")
                    append("Content-Type: application/json; charset=utf-8\r\n")
                    append("Content-Length: ${payload.size}\r\n")
                    append("Connection: close\r\n\r\n")
                }.toByteArray(Charsets.UTF_8)
                connection.getOutputStream().use {
                    it.write(response)
                    it.write(payload)
                    it.flush()
                }
            }
        } catch (_: IOException) {
            // Tests close the socket after timeout/error assertions.
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    fun stop(timeout: Int) {
        socket.close()
        worker.interrupt()
        worker.join(timeout.toLong())
    }

    private fun statusText(code: Int) = when (code) {
        200 -> "OK"
        201 -> "Created"
        401 -> "Unauthorized"
        403 -> "Forbidden"
        409 -> "Conflict"
        else -> "Error"
    }
}

private fun BufferedInputStream.readHttpLine(): String? {
    val bytes = ByteArrayOutputStream()
    while (true) {
        val value = read()
        if (value < 0) return if (bytes.size() == 0) null else bytes.toString(Charsets.UTF_8.name())
        if (value == '\n'.code) {
            val result = bytes.toString(Charsets.UTF_8.name())
            return result.removeSuffix("\r")
        }
        bytes.write(value)
    }
}

private suspend inline fun <reified T : Throwable> assertThrows(block: suspend () -> Unit) {
    try {
        block()
    } catch (error: Throwable) {
        assertTrue("Expected ${T::class.simpleName}, got ${error::class.simpleName}", error is T)
        return
    }
    throw AssertionError("Expected ${T::class.simpleName}")
}
