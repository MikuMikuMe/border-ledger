package com.lofuyu.borderledger.react

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiptTextLayoutTest {

    @Test fun reconstructsRowsAcrossOcrBlocks() {
        val lines=listOf(ReceiptTextLine("12.50",300,102,360,122),ReceiptTextLine("SHOP",10,10,90,30),ReceiptTextLine("TOTAL",10,100,100,120),ReceiptTextLine("SUBTOTAL",10,60,120,80),ReceiptTextLine("11.00",300,61,360,81))
        assertEquals("SHOP\nSUBTOTAL 11.00\nTOTAL 12.50", receiptTextInReadingOrder(lines, "fallback"))
    }
    @Test fun keepsNeighboringRowsSeparateAndDoesNotCombineOverlappingColumns() {
        val lines=listOf(ReceiptTextLine("TOTAL",10,100,100,120),ReceiptTextLine("12.50",300,124,360,144),ReceiptTextLine("EXTRA",50,100,140,120))
        assertEquals("TOTAL\nEXTRA\n12.50",receiptTextInReadingOrder(lines,"fallback"))
    }
    @Test fun preservesTextWithoutValidCoordinatesAndFallsBackWhenNoneAreLocated() {
        val lines=listOf(ReceiptTextLine("TOTAL",10,100,100,120),ReceiptTextLine("12.50",300,100,360,120),ReceiptTextLine("unlocated",0,0,0,0))
        assertEquals("TOTAL 12.50\nunlocated",receiptTextInReadingOrder(lines,"fallback"))
        assertEquals("fallback",receiptTextInReadingOrder(emptyList(),"fallback"))
    }
    @Test fun handlesAlignedButUnrelatedColumnsConservatively() {
        val lines=listOf(ReceiptTextLine("TOTAL",10,100,100,120),ReceiptTextLine("TAX",150,101,210,121),ReceiptTextLine("12.50",300,102,360,122))
        assertEquals("TOTAL TAX 12.50", receiptTextInReadingOrder(lines,"fallback"))
    }
}
