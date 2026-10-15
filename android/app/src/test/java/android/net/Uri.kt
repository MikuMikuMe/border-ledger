package android.net

import java.net.URI as JavaUri
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

/** Minimal JVM test implementation for the Android Uri API used by pure logic tests. */
class Uri private constructor(private val raw: String) {
    private val parsed: JavaUri = JavaUri(raw)

    val scheme: String?
        get() = parsed.scheme
    val host: String?
        get() = parsed.host
    val port: Int
        get() = parsed.port
    val path: String?
        get() = parsed.path
    val fragment: String?
        get() = parsed.fragment
    val queryParameterNames: Set<String>
        get() = queryParameters().keys

    fun getQueryParameter(name: String): String? = queryParameters()[name]

    fun getQueryParameters(name: String): List<String> = queryParameters()
        .filter { it.key == name }
        .values
        .mapNotNull { it }

    override fun toString(): String = raw

    private fun queryParameters(): Map<String, String?> = parsed.rawQuery
        ?.split('&')
        ?.filter { it.isNotEmpty() }
        ?.associate { pair ->
            val separator = pair.indexOf('=')
            val key = if (separator < 0) pair else pair.substring(0, separator)
            val value = if (separator < 0) null else pair.substring(separator + 1)
            decode(key) to value?.let(::decode)
        }
        .orEmpty()

    private fun decode(value: String): String = URLDecoder.decode(value, StandardCharsets.UTF_8.name())

    companion object {
        @JvmStatic
        fun parse(value: String): Uri = Uri(value)
    }
}
