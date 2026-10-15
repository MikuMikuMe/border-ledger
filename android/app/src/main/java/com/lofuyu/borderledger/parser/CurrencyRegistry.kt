package com.lofuyu.borderledger.parser

import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode
import java.util.Locale

data class CurrencyMeta(
    val code: String,
    val minorUnitDigits: Int,
) {
    init {
        require(code.length == 3 && code == code.uppercase()) { "Currency code must be uppercase and three characters." }
        require(minorUnitDigits in 0..3) { "Minor-unit digits must be between zero and three." }
    }
}

class CurrencyRegistry(entries: Map<String, CurrencyMeta> = DEFAULT_ENTRIES) {
    private val values: Map<String, CurrencyMeta> = entries.toMap()

    init {
        require(values.keys.all { it.length == 3 && it == it.uppercase() })
        require(values.all { (key, value) -> key == value.code })
    }

    fun metadata(code: String): CurrencyMeta? = values[normalizeFullWidth(code).uppercase(Locale.ROOT)]

    fun resolveCurrencyToken(token: String?): String? {
        val normalized = normalizeFullWidth(token.orEmpty()).trim().uppercase(Locale.ROOT)
        if (normalized.isBlank()) return null
        if (metadata(normalized) != null) return normalized
        return when (normalized) {
            "RMB", "人民币", "人民幣", "CN¥", "CNY¥" -> "CNY".takeIf { metadata(it) != null }
            "美元", "US$", "US﹩" -> "USD".takeIf { metadata(it) != null }
            "港币", "港幣", "HK$", "HK﹩" -> "HKD".takeIf { metadata(it) != null }
            "加元", "CA$", "C$", "CA﹩" -> "CAD".takeIf { metadata(it) != null }
            // Bare dollar/yuan symbols are intentionally ambiguous.
            "$", "¥", "￥", "﹩" -> null
            else -> null
        }
    }

    fun parseMinor(raw: String, currency: String): Long? {
        val meta = metadata(currency) ?: return null
        val normalized = normalizeNumeric(raw) ?: return null
        return try {
            val decimal = BigDecimal(normalized)
            if (decimal.signum() <= 0 || decimal.scale() > meta.minorUnitDigits) {
                null
            } else {
            val scaled = decimal.setScale(meta.minorUnitDigits, RoundingMode.UNNECESSARY)
                .movePointRight(meta.minorUnitDigits)
            val value = scaled.toBigIntegerExact()
            if (value > MAX_SAFE_BIG_INTEGER || value < MIN_SAFE_BIG_INTEGER) null else value.toLong()
            }
        } catch (_: ArithmeticException) {
            null
        } catch (_: NumberFormatException) {
            null
        }
    }

    private fun normalizeNumeric(raw: String): String? {
        val value = raw.trim()
            .map { character ->
                when (character) {
                    in '\uFF10'..'\uFF19' -> ('0'.code + character.code - '\uFF10'.code).toChar()
                    '\uFF0E' -> '.'
                    '\uFF0C' -> ','
                    else -> character
                }
            }
            .joinToString("")
        val grouping = Regex("\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?")
        val plain = Regex("\\d+(?:\\.\\d+)?")
        return when {
            grouping.matches(value) -> value.replace(",", "")
            plain.matches(value) -> value
            else -> null
        }
    }

    private fun normalizeFullWidth(value: String): String = value.map { character ->
        when (character) {
            in '\uFF21'..'\uFF3A' -> ('A'.code + character.code - '\uFF21'.code).toChar()
            in '\uFF41'..'\uFF5A' -> ('a'.code + character.code - '\uFF41'.code).toChar()
            '\uFF04' -> '$'
            '\uFFE5' -> '¥'
            else -> character
        }
    }.joinToString("")

    companion object {
        const val MAX_SAFE_INTEGER: Long = 9_007_199_254_740_991L
        const val MIN_SAFE_INTEGER: Long = -9_007_199_254_740_991L
        val MAX_SAFE_BIG_INTEGER: BigInteger = BigInteger.valueOf(MAX_SAFE_INTEGER)
        val MIN_SAFE_BIG_INTEGER: BigInteger = BigInteger.valueOf(MIN_SAFE_INTEGER)
        private val DEFAULT_MINOR_UNITS: Map<String, Int> = mapOf(
            "AED" to 2, "AFN" to 2, "ALL" to 2, "AMD" to 2, "ANG" to 2,
            "AOA" to 2, "ARS" to 2, "AUD" to 2, "AWG" to 2, "AZN" to 2,
            "BAM" to 2, "BBD" to 2, "BDT" to 2, "BGN" to 2, "BHD" to 3,
            "BIF" to 0, "BMD" to 2, "BND" to 2, "BOB" to 2, "BRL" to 2,
            "BSD" to 2, "BTN" to 2, "BWP" to 2, "BYN" to 2, "BZD" to 2,
            "CAD" to 2, "CDF" to 2, "CHF" to 2, "CLP" to 0, "CNY" to 2,
            "COP" to 2, "CRC" to 2, "CUC" to 2, "CUP" to 2, "CVE" to 2,
            "CZK" to 2, "DJF" to 0, "DKK" to 2, "DOP" to 2, "DZD" to 2,
            "EGP" to 2, "ERN" to 2, "ETB" to 2, "EUR" to 2, "FJD" to 2,
            "FKP" to 2, "GBP" to 2, "GEL" to 2, "GHS" to 2, "GIP" to 2,
            "GMD" to 2, "GNF" to 0, "GTQ" to 2, "GYD" to 2, "HKD" to 2,
            "HNL" to 2, "HRK" to 2, "HTG" to 2, "HUF" to 2, "IDR" to 2,
            "ILS" to 2, "INR" to 2, "IQD" to 3, "IRR" to 2, "ISK" to 0,
            "JMD" to 2, "JOD" to 3, "JPY" to 0, "KES" to 2, "KGS" to 2,
            "KHR" to 2, "KMF" to 0, "KPW" to 2, "KRW" to 0, "KWD" to 3,
            "KYD" to 2, "KZT" to 2, "LAK" to 2, "LBP" to 2, "LKR" to 2,
            "LRD" to 2, "LSL" to 2, "LYD" to 3, "MAD" to 2, "MDL" to 2,
            "MGA" to 2, "MKD" to 2, "MMK" to 2, "MNT" to 2, "MOP" to 2,
            "MRU" to 2, "MUR" to 2, "MVR" to 2, "MWK" to 2, "MXN" to 2,
            "MYR" to 2, "MZN" to 2, "NAD" to 2, "NGN" to 2, "NIO" to 2,
            "NOK" to 2, "NPR" to 2, "NZD" to 2, "OMR" to 3, "PAB" to 2,
            "PEN" to 2, "PGK" to 2, "PHP" to 2, "PKR" to 2, "PLN" to 2,
            "PYG" to 0, "QAR" to 2, "RON" to 2, "RSD" to 2, "RUB" to 2,
            "RWF" to 0, "SAR" to 2, "SBD" to 2, "SCR" to 2, "SDG" to 2,
            "SEK" to 2, "SGD" to 2, "SHP" to 2, "SLE" to 2, "SLL" to 2,
            "SOS" to 2, "SRD" to 2, "SSP" to 2, "STN" to 2, "SVC" to 2,
            "SYP" to 2, "SZL" to 2, "THB" to 2, "TJS" to 2, "TMT" to 2,
            "TND" to 3, "TOP" to 2, "TRY" to 2, "TTD" to 2, "TWD" to 2,
            "TZS" to 2, "UAH" to 2, "UGX" to 0, "USD" to 2, "UYU" to 2,
            "UZS" to 2, "VES" to 2, "VND" to 0, "VUV" to 0, "WST" to 2,
            "XAF" to 0, "XCD" to 2, "XCG" to 2, "XDR" to 0, "XOF" to 0,
            "XPF" to 0, "XSU" to 0, "YER" to 2, "ZAR" to 2, "ZMW" to 2,
            "ZWG" to 2, "ZWL" to 2,
        )
        val DEFAULT_ENTRIES: Map<String, CurrencyMeta> = DEFAULT_MINOR_UNITS.mapValues { (code, digits) -> CurrencyMeta(code, digits) }
        val DEFAULT_CODES: Set<String> = DEFAULT_ENTRIES.keys
    }
}
