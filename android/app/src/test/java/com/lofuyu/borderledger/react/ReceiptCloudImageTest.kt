package com.lofuyu.borderledger.react

import java.io.ByteArrayInputStream
import java.util.Base64
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ReceiptCloudImageTest {
    @Test fun encodesTheImageWithoutWritingItToDisk() {
        val bytes=byteArrayOf(1,2,3,4)
        assertArrayEquals(bytes,Base64.getDecoder().decode(receiptImageBase64(ByteArrayInputStream(bytes),10)))
    }
    @Test fun rejectsImagesAboveTheLimit() {
        assertThrows(IllegalArgumentException::class.java) { receiptImageBase64(ByteArrayInputStream(ByteArray(11)),10) }
    }
}
