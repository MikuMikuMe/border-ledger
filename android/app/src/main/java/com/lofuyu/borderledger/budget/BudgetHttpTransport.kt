package com.lofuyu.borderledger.budget

import com.lofuyu.borderledger.api.TransportFailure
import com.lofuyu.borderledger.auth.MobileRequest
import com.lofuyu.borderledger.recurring.RecurringHttpResponse
import com.lofuyu.borderledger.recurring.RecurringHttpTransport
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

internal class BudgetHttpTransport(private val readTimeoutMillis: Int = 15_000) : RecurringHttpTransport {
    override suspend fun execute(request: MobileRequest): RecurringHttpResponse = withContext(Dispatchers.IO) { executeBlocking(request) }

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

    private fun readResponse(input: InputStream?): ByteArray = input?.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = stream.read(buffer)
            if (count < 0) break
            if (output.size() + count > 1024 * 1024) throw TransportFailure.Unavailable
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    } ?: ByteArray(0)

    private fun executeBlocking(request: MobileRequest): RecurringHttpResponse {
        val connection = try { openConnection(request) } catch (_: IOException) { throw TransportFailure.Offline }
        return try {
            request.body?.let { bytes -> connection.outputStream.use { it.write(bytes) } }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            RecurringHttpResponse(status, readResponse(stream))
        } catch (error: TransportFailure) { throw error }
        catch (_: IOException) { throw TransportFailure.Offline }
        finally { connection.disconnect() }
    }
}
