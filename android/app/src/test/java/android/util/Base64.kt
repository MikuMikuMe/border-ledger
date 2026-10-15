package android.util

/** Minimal JVM test implementation for the Android Base64 API used by auth tests. */
object Base64 {
    const val URL_SAFE: Int = 8
    const val NO_WRAP: Int = 2
    const val NO_PADDING: Int = 1

    @JvmStatic
    fun encodeToString(input: ByteArray, flags: Int): String = java.util.Base64.getUrlEncoder()
        .let { encoder -> if (flags and NO_PADDING != 0) encoder.withoutPadding() else encoder }
        .encodeToString(input)
}
