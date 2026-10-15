package com.lofuyu.borderledger.imports

import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StatementDocumentReaderTest {
    @Test
    fun canceledPickerIsAnExplicitOutcome() {
        val result = reader().read(null)

        assertEquals(DocumentReadResult.Canceled, result)
    }

    @Test
    fun revokedUriPermissionIsNotReportedAsAnEmptyImport() {
        val result = reader(permission = { throw SecurityException("revoked") }).read(uri())

        assertEquals(DocumentReadResult.PermissionLost, result)
    }

    @Test
    fun oversizedDocumentStopsBeforeReadingPastTenMiB() {
        val result = reader(length = StatementDocumentReader.MAX_FILE_BYTES + 1L).read(uri())

        assertEquals(DocumentReadResult.TooLarge, result)
    }

    @Test
    fun unsupportedAndCorruptDocumentsHaveDifferentOutcomes() {
        assertEquals(DocumentReadResult.UnsupportedFormat, reader(name = "statement.pdf").read(uri()))
        assertEquals(DocumentReadResult.Corrupt("invalid_utf8"), reader(bytes = byteArrayOf(0xC3.toByte(), 0x28)).read(uri()))
    }

    @Test
    fun chineseQuotedCsvKeepsRowsAndReportsRequiredColumnOrCurrencyErrors() {
        val csv = "Date,Description,Amount,Currency,Category\n2026-10-13,\"北京,咖啡\",-12.34,CAD,Food\n2026-10-13,Bad,-1.234,JPY,Food"
        val result = reader(bytes = csv.toByteArray()).read(uri()) as DocumentReadResult.Success

        assertEquals("北京,咖啡", result.rows.single().merchant)
        assertEquals(-1234L, result.rows.single().amountMinor)
        assertTrue(result.errors.any { it.contains("currency", ignoreCase = true) })
    }

    @Test
    fun canonicalMinorUnitColumnDoesNotScaleTheAmountAgain() {
        val csv = "Id,AccountId,Date,Merchant,AmountMinor,Currency\nrow-1,account-1,2026-10-13,Cafe,-1234,CAD"

        val result = reader(bytes = csv.toByteArray()).read(uri()) as DocumentReadResult.Success

        assertEquals(-1234L, result.rows.single().amountMinor)
        assertEquals("Cafe", result.rows.single().merchant)
    }

    @Test
    fun registeredCurrenciesUseTheirMinorUnitMetadataAndUnknownCodesAreRejected() {
        val csv = "Date,Description,Amount,Currency\n" +
            "2026-10-13,Euro shop,12.34,EUR\n" +
            "2026-10-13,Yen shop,123,JPY\n" +
            "2026-10-13,Dinar shop,1.234,TND\n" +
            "2026-10-13,Unknown shop,1.00,ZZZ"

        val result = reader(bytes = csv.toByteArray()).read(uri()) as DocumentReadResult.Success

        assertEquals(listOf("EUR", "JPY", "TND"), result.rows.map { it.currency })
        assertEquals(listOf(1234L, 123L, 1234L), result.rows.map { it.amountMinor })
        assertTrue(result.errors.any { it.contains("invalid currency", ignoreCase = true) })
    }

    @Test
    fun malformedCsvIsCorruptRatherThanAnEmptyPreview() {
        val result = reader(bytes = "Date,Description,Amount,Currency\n2026-10-13,\"unterminated,-1.00,CAD".toByteArray())
            .read(uri())

        assertEquals(DocumentReadResult.Corrupt("invalid_csv"), result)
    }

    @Test
    fun unknownLengthStillStopsWhenTheStreamExceedsTenMiB() {
        val bytes = ByteArray((StatementDocumentReader.MAX_FILE_BYTES + 1L).toInt())
        val result = reader(bytes = bytes, length = -1L).read(uri())

        assertEquals(DocumentReadResult.TooLarge, result)
    }

    @Test
    fun oversizedUnknownLengthStreamDoesNotReadAWholeBufferPastTheLimit() {
        val source = CountingSource(ByteArray((StatementDocumentReader.MAX_FILE_BYTES + 16_000L).toInt()))

        val result = StatementDocumentReader(source).read(uri())

        assertEquals(DocumentReadResult.TooLarge, result)
        assertTrue(source.bytesRead <= StatementDocumentReader.MAX_FILE_BYTES + 1L)
    }

    @Test
    fun missingRequiredColumnsRemainVisibleAsReaderErrors() {
        val result = reader(bytes = "Date,Description\n2026-10-13,Cafe".toByteArray()).read(uri()) as DocumentReadResult.Success

        assertTrue(result.rows.isEmpty())
        assertTrue(result.errors.any { it.contains("Amount", ignoreCase = true) })
        assertTrue(result.errors.any { it.contains("Currency", ignoreCase = true) })
    }

    private fun reader(
        name: String = "statement.csv",
        bytes: ByteArray = "Date,Description,Amount,Currency\n2026-10-13,Cafe,-1.00,CAD".toByteArray(),
        length: Long = bytes.size.toLong(),
        permission: () -> Unit = {},
    ) = StatementDocumentReader(FakeSource(name, bytes, length, permission))

    private fun uri() = android.net.Uri.parse("content://test/statement")
}

private class FakeSource(
    private val name: String,
    private val bytes: ByteArray,
    private val length: Long,
    private val permission: () -> Unit,
) : StatementDocumentSource {
    override fun displayName(uri: android.net.Uri): String = name
    override fun mimeType(uri: android.net.Uri): String? = if (name.endsWith(".csv")) "text/csv" else "application/pdf"
    override fun length(uri: android.net.Uri): Long = length
    override fun persistReadPermission(uri: android.net.Uri) = permission()
    override fun open(uri: android.net.Uri) = ByteArrayInputStream(bytes)
}

private class CountingSource(
    private val bytes: ByteArray,
) : StatementDocumentSource {
    var bytesRead: Long = 0
        private set

    override fun displayName(uri: android.net.Uri): String = "statement.csv"
    override fun mimeType(uri: android.net.Uri): String? = "text/csv"
    override fun length(uri: android.net.Uri): Long = -1L
    override fun persistReadPermission(uri: android.net.Uri) = Unit
    override fun open(uri: android.net.Uri): InputStream = object : InputStream() {
        private val delegate = ByteArrayInputStream(bytes)

        override fun read(): Int {
            val result = delegate.read()
            if (result >= 0) bytesRead += 1
            return result
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            val result = delegate.read(buffer, offset, length)
            if (result > 0) bytesRead += result
            return result
        }

        override fun close() = delegate.close()
    }
}
