package com.lofuyu.borderledger.wealth

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.MobileRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

data class WealthHttpResponse(val statusCode: Int, val body: String)

fun interface WealthHttpTransport {
    suspend fun execute(request: MobileRequest): WealthHttpResponse
}

internal class UrlWealthHttpTransport(private val readTimeoutMillis: Int = 15_000) : WealthHttpTransport {
    override suspend fun execute(request: MobileRequest): WealthHttpResponse = withContext(Dispatchers.IO) {
        val connection = try { openConnection(request) } catch (_: IOException) { throw TransportFailure.Offline }
        try {
            request.body?.let { bytes -> connection.outputStream.use { it.write(bytes) } }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            WealthHttpResponse(status, readResponse(stream))
        } catch (failure: TransportFailure) { throw failure }
        catch (_: IOException) { throw TransportFailure.Offline }
        finally { connection.disconnect() }
    }

    private fun openConnection(request: MobileRequest): HttpURLConnection =
        (URL(request.url).openConnection() as HttpURLConnection).apply {
            requestMethod = request.method
            instanceFollowRedirects = false
            connectTimeout = 15_000
            readTimeout = readTimeoutMillis
            request.headers.forEach { (name, value) -> setRequestProperty(name, value) }
            setRequestProperty("Cache-Control", "no-store")
            if (request.body != null) doOutput = true
        }

    private fun readResponse(input: InputStream?): String = input?.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            if (output.size() + count > MAX_RESPONSE_BYTES) throw TransportFailure.Unavailable
            output.write(buffer, 0, count)
        }
        output.toString(Charsets.UTF_8.name())
    } ?: ""

    private companion object { const val MAX_RESPONSE_BYTES = 2 * 1024 * 1024 }
}
