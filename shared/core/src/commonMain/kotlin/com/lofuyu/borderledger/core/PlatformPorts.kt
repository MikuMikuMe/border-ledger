package com.lofuyu.borderledger.core

/** Native-only dependencies. Implementations must never surface secrets to a UI bridge. */
interface CoreClock {
    fun nowIso(): String
    /** Strict comparison; platform parsers preserve the existing ISO/offset semantics. */
    fun isAfterNow(iso: String): Boolean
}

interface CoreCrypto {
    fun randomToken(byteCount: Int): String
    fun sha256Hex(value: String): String
    fun pkceChallenge(verifier: String): String
}

fun interface BrowserPort {
    suspend fun open(authorizationUrl: String)
}

/** Opaque native handle, never a document payload. Platform adapters own URI permissions. */
data class NativeFileHandle(val id: String)

interface FilePort {
    suspend fun readChunk(file: NativeFileHandle, offset: Long, maximumBytes: Int): ByteArray
    suspend fun close(file: NativeFileHandle)
}

/** Native encrypted-store port: Android codecs own the named records and their bytes. */
interface SecureRecordPort {
    suspend fun read(record: String): ByteArray?
    suspend fun write(record: String, value: ByteArray)
    suspend fun delete(record: String)
}

/** Transport models contain native credentials; do not use them as bridge DTOs. */
data class CoreHttpRequest(val method: String, val url: String, val headers: Map<String, String> = emptyMap(), val body: ByteArray? = null)
data class CoreHttpResponse(val status: Int, val body: ByteArray)
fun interface HttpPort { suspend fun execute(request: CoreHttpRequest): CoreHttpResponse }

fun minorUnitsToDecimalString(value: Long): String = value.toString()
