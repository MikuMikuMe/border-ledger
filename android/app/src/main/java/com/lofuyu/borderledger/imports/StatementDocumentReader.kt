package com.lofuyu.borderledger.imports

import android.content.ContentResolver
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.math.BigDecimal
import java.math.RoundingMode
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.Locale
import com.lofuyu.borderledger.parser.CurrencyRegistry

/** The only document format accepted by the native import flow at this scope. */
const val MAX_IMPORT_FILE_BYTES: Long = 10L * 1024L * 1024L

/** A narrow seam around Android's document provider so the parser is testable without a device. */
interface StatementDocumentSource {
    fun displayName(uri: Uri): String
    fun mimeType(uri: Uri): String?
    fun length(uri: Uri): Long
    fun persistReadPermission(uri: Uri)
    fun open(uri: Uri): InputStream
}

/** ContentResolver implementation used by a document-picker host. */
class ContentResolverStatementDocumentSource(
    private val resolver: ContentResolver,
) : StatementDocumentSource {
    override fun displayName(uri: Uri): String = queryString(uri, OpenableColumns.DISPLAY_NAME)
        ?: uri.lastPathSegment
        ?: "statement.csv"

    override fun mimeType(uri: Uri): String? = resolver.getType(uri)

    override fun length(uri: Uri): Long = queryLong(uri, OpenableColumns.SIZE) ?: -1L

    override fun persistReadPermission(uri: Uri) {
        resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    override fun open(uri: Uri): InputStream = resolver.openInputStream(uri)
        ?: throw FileNotFoundException("The selected document could not be opened.")

    private fun queryString(uri: Uri, column: String): String? = resolver.query(
        uri,
        arrayOf(column),
        null,
        null,
        null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getStringOrNull(column) else null
    }

    private fun queryLong(uri: Uri, column: String): Long? = resolver.query(
        uri,
        arrayOf(column),
        null,
        null,
        null,
    )?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getLongOrNull(column) else null
    }

    private fun Cursor.getStringOrNull(column: String): String? {
        val index = getColumnIndex(column)
        return if (index >= 0 && !isNull(index)) getString(index) else null
    }

    private fun Cursor.getLongOrNull(column: String): Long? {
        val index = getColumnIndex(column)
        return if (index >= 0 && !isNull(index)) getLong(index) else null
    }
}

typealias AndroidStatementDocumentSource = ContentResolverStatementDocumentSource

data class StatementRow(
    val rowId: String,
    val rowIndex: Int,
    val date: String,
    val merchant: String,
    val amountMinor: Long,
    val currency: String,
    val category: String = "Uncategorized",
    val kind: String = "expense",
    val status: String = "confirmed",
    val source: String = "statement",
    val fingerprint: String,
    val note: String? = null,
    val bankReference: String? = null,
)

sealed interface DocumentReadResult {
    data object Canceled : DocumentReadResult
    data object PermissionLost : DocumentReadResult
    data object TooLarge : DocumentReadResult
    data object UnsupportedFormat : DocumentReadResult
    data class Corrupt(val reason: String) : DocumentReadResult
    data class Unavailable(val reason: String) : DocumentReadResult

    data class Success(
        val fileName: String,
        val fileSizeBytes: Long,
        val fileSha256: String,
        val rows: List<StatementRow>,
        val errors: List<String> = emptyList(),
    ) : DocumentReadResult
}

/**
 * Reads a picker URI with a hard byte ceiling, strict UTF-8 and a small RFC-4180 CSV
 * parser. It deliberately returns explicit non-success outcomes for picker and format
 * failures so callers cannot turn a missing document into an empty import.
 */
class StatementDocumentReader(
    private val source: StatementDocumentSource,
    private val maxFileBytes: Long = MAX_IMPORT_FILE_BYTES,
    private val currencies: CurrencyRegistry = CurrencyRegistry(),
) {
    init {
        require(maxFileBytes > 0) { "The document limit must be positive." }
    }

    fun read(uri: Uri?): DocumentReadResult {
        if (uri == null) return DocumentReadResult.Canceled

        val name: String
        val mime: String?
        val declaredLength: Long
        try {
            source.persistReadPermission(uri)
            name = source.displayName(uri)
            mime = source.mimeType(uri)
            declaredLength = source.length(uri)
        } catch (_: SecurityException) {
            return DocumentReadResult.PermissionLost
        } catch (error: FileNotFoundException) {
            return DocumentReadResult.PermissionLost
        } catch (_: IOException) {
            return DocumentReadResult.Unavailable("metadata_unavailable")
        } catch (_: RuntimeException) {
            return DocumentReadResult.Unavailable("metadata_unavailable")
        }

        if (declaredLength > maxFileBytes) return DocumentReadResult.TooLarge
        if (!isCsv(name, mime)) return DocumentReadResult.UnsupportedFormat

        val bytes = try {
            source.open(uri).use { readBounded(it) }
        } catch (_: SecurityException) {
            return DocumentReadResult.PermissionLost
        } catch (_: FileNotFoundException) {
            return DocumentReadResult.PermissionLost
        } catch (_: TooLargeException) {
            return DocumentReadResult.TooLarge
        } catch (_: IOException) {
            return DocumentReadResult.Unavailable("read_failed")
        }

        val text = try {
            decodeUtf8(bytes)
        } catch (_: CharacterCodingException) {
            return DocumentReadResult.Corrupt("invalid_utf8")
        }
        val fileHash = sha256(bytes)
        val records = parseCsv(text) ?: return DocumentReadResult.Corrupt("invalid_csv")
        return parseRows(name, bytes.size.toLong(), fileHash, records)
    }

    fun createOpenDocumentIntent(): Intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
        .addCategory(Intent.CATEGORY_OPENABLE)
        .setType("text/csv")
        .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("text/csv", "text/plain"))
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)

    private fun readBounded(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream(minOf(maxFileBytes, 64L * 1024L).toInt())
        val buffer = ByteArray(16 * 1024)
        var total = 0L
        while (true) {
            val remaining = maxFileBytes - total
            val requested = minOf(buffer.size.toLong(), remaining + 1L).toInt()
            val count = input.read(buffer, 0, requested)
            if (count < 0) break
            total += count
            if (total > maxFileBytes) throw TooLargeException
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun decodeUtf8(bytes: ByteArray): String {
        val decoder = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
        val value = decoder.decode(ByteBuffer.wrap(bytes)).toString()
        return value.removePrefix("\uFEFF")
    }

    private fun parseRows(
        fileName: String,
        fileSizeBytes: Long,
        fileHash: String,
        records: List<List<String>>,
    ): DocumentReadResult.Success {
        if (records.isEmpty()) {
            return DocumentReadResult.Success(fileName, fileSizeBytes, fileHash, emptyList(), listOf("The CSV has no header row."))
        }
        val header = records.first().map { it.trim().removePrefix("\uFEFF").lowercase(Locale.ROOT) }
        val dateColumn = header.firstIndexOfFirst("date")
        val merchantColumn = header.firstIndexOfFirst("description", "merchant", "name")
        val amountMinorColumn = header.firstIndexOfFirst("amountminor", "amount minor", "minorunits", "minor units")
        val amountColumn = header.firstIndexOfFirst("amount", "amountmajor", "amount major", "value")
        val currencyColumn = header.firstIndexOfFirst("currency", "iso currency")
        val missing = buildList {
            if (dateColumn < 0) add("Missing required column: Date")
            if (merchantColumn < 0) add("Missing required column: Description")
            if (amountMinorColumn < 0 && amountColumn < 0) add("Missing required column: Amount")
            if (currencyColumn < 0) add("Missing required column: Currency")
        }
        if (missing.isNotEmpty()) return DocumentReadResult.Success(fileName, fileSizeBytes, fileHash, emptyList(), missing)

        val categoryColumn = header.firstIndexOfFirst("category")
        val noteColumn = header.firstIndexOfFirst("note", "notes")
        val bankReferenceColumn = header.firstIndexOfFirst("bankreference", "bank reference", "reference")
        val rows = mutableListOf<StatementRow>()
        val errors = mutableListOf<String>()
        records.drop(1).forEachIndexed { dataIndex, record ->
            if (record.all { it.isBlank() }) return@forEachIndexed
            val displayIndex = dataIndex + 2
            fun valueAt(index: Int): String = record.getOrNull(index)?.trim().orEmpty()
            val date = valueAt(dateColumn)
            val merchant = valueAt(merchantColumn)
            val rawAmount = valueAt(if (amountMinorColumn >= 0) amountMinorColumn else amountColumn)
            val currency = valueAt(currencyColumn).uppercase(Locale.ROOT)
            val category = valueAt(categoryColumn).ifBlank { "Uncategorized" }
            val rowErrors = mutableListOf<String>()
            try {
                LocalDate.parse(date)
            } catch (_: DateTimeParseException) {
                rowErrors += "Row $displayIndex has an invalid date."
            }
            if (merchant.isBlank()) rowErrors += "Row $displayIndex has an empty Description."
            val currencyMeta = currencies.metadata(currency)
            if (currencyMeta == null) {
                rowErrors += "Row $displayIndex has an invalid currency."
            }
            val amountMinor = if (currencyMeta != null) {
                if (amountMinorColumn >= 0) parseMinorUnits(rawAmount) else parseMajor(rawAmount, currency)
            } else {
                null
            }
            if (amountMinor == null) {
                rowErrors += if (amountMinorColumn >= 0) {
                    "Row $displayIndex AmountMinor must be a signed integer."
                } else {
                    "Row $displayIndex amount does not match the currency scale."
                }
            }
            if (rowErrors.isNotEmpty()) {
                errors += rowErrors
                return@forEachIndexed
            }
            val amount = requireNotNull(amountMinor)
            rows += StatementRow(
                rowId = "row-${dataIndex + 1}",
                rowIndex = dataIndex,
                date = date,
                merchant = merchant,
                amountMinor = amount,
                currency = currency,
                category = category,
                kind = if (amount > 0) "income" else "expense",
                fingerprint = "statement:$fileHash:$dataIndex",
                note = valueAt(noteColumn).ifBlank { null },
                bankReference = valueAt(bankReferenceColumn).ifBlank { null },
            )
        }
        return DocumentReadResult.Success(fileName, fileSizeBytes, fileHash, rows, errors)
    }

    private fun parseMajor(raw: String, currency: String): Long? {
        val normalized = raw.trim().replace('−', '-').replace(",", "")
        if (normalized.isBlank()) return null
        return try {
            val metadata = currencies.metadata(currency) ?: return null
            val sign = when {
                normalized.startsWith("-") -> -1
                normalized.startsWith("+") -> 1
                else -> 1
            }
            val magnitude = normalized.removePrefix("-").removePrefix("+")
            val minorUnits = BigDecimal(magnitude)
                .setScale(metadata.minorUnitDigits, RoundingMode.UNNECESSARY)
                .movePointRight(metadata.minorUnitDigits)
                .longValueExact()
            if (minorUnits > CurrencyRegistry.MAX_SAFE_INTEGER) null else if (sign < 0) -minorUnits else minorUnits
        } catch (_: ArithmeticException) {
            null
        } catch (_: NumberFormatException) {
            null
        }
    }

    private fun parseMinorUnits(raw: String): Long? {
        val normalized = raw.trim().replace('−', '-')
        if (!normalized.matches(Regex("[+-]?\\d+"))) return null
        return normalized.toLongOrNull()
    }

    private fun isCsv(name: String, mime: String?): Boolean {
        val lowerName = name.lowercase(Locale.ROOT)
        if (lowerName.endsWith(".pdf") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return false
        return lowerName.endsWith(".csv") || mime.orEmpty().lowercase(Locale.ROOT) in setOf(
            "text/csv",
            "text/comma-separated-values",
            "text/plain",
            "application/csv",
        )
    }

    private fun parseCsv(text: String): List<List<String>>? {
        val records = mutableListOf<List<String>>()
        val fields = mutableListOf<String>()
        val field = StringBuilder()
        var inQuotes = false
        var afterClosingQuote = false
        var index = 0
        var sawAny = false

        fun finishField() {
            fields += field.toString()
            field.setLength(0)
            afterClosingQuote = false
        }

        fun finishRecord() {
            finishField()
            if (fields.any { it.isNotEmpty() }) records += fields.toList()
            fields.clear()
            sawAny = false
        }

        while (index < text.length) {
            val character = text[index]
            sawAny = true
            if (inQuotes) {
                if (character == '"') {
                    if (index + 1 < text.length && text[index + 1] == '"') {
                        field.append('"')
                        index += 2
                        continue
                    }
                    inQuotes = false
                    afterClosingQuote = true
                } else {
                    field.append(character)
                }
                index += 1
                continue
            }
            when (character) {
                '"' -> {
                    if (field.isNotEmpty() || afterClosingQuote) return null
                    inQuotes = true
                    index += 1
                }
                ',' -> {
                    finishField()
                    index += 1
                }
                '\r' -> {
                    if (index + 1 < text.length && text[index + 1] == '\n') index += 1
                    finishRecord()
                    index += 1
                }
                '\n' -> {
                    finishRecord()
                    index += 1
                }
                else -> {
                    if (afterClosingQuote && !character.isWhitespace()) return null
                    if (!afterClosingQuote || character.isWhitespace()) field.append(character)
                    index += 1
                }
            }
        }
        if (inQuotes) return null
        if (sawAny || fields.isNotEmpty() || field.isNotEmpty()) finishRecord()
        return records
    }

    private fun List<String>.firstIndexOfFirst(vararg names: String): Int = indexOfFirst { value -> value in names }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte) }

    private object TooLargeException : RuntimeException()

    companion object {
        const val MAX_FILE_BYTES: Int = 10 * 1024 * 1024
    }
}
