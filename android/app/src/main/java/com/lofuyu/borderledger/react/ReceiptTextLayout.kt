package com.lofuyu.borderledger.react

internal data class ReceiptTextLine(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val positioned get() = right > left && bottom > top
}

private fun sameReceiptRow(line: ReceiptTextLine, row: List<ReceiptTextLine>): Boolean = row.all { other ->
    val overlap = minOf(line.bottom, other.bottom) - maxOf(line.top, other.top)
    val smallerHeight = minOf(line.bottom - line.top, other.bottom - other.top)
    overlap > 0 && overlap * 2 >= smallerHeight && (line.right <= other.left || other.right <= line.left)
}

internal fun receiptTextInReadingOrder(lines: List<ReceiptTextLine>, fallback: String): String {
    val positioned = lines.filter { it.positioned && it.text.isNotBlank() }.sortedWith(compareBy({ it.top }, { it.left }))
    if (positioned.isEmpty()) return fallback
    val rows = mutableListOf<MutableList<ReceiptTextLine>>()
    for (line in positioned) {
        val row = rows.lastOrNull { sameReceiptRow(line, it) }
        if (row == null) rows.add(mutableListOf(line)) else row.add(line)
    }
    val reconstructed = rows.map { row -> row.sortedBy { it.left }.joinToString(" ") { it.text.trim() } }
    val unpositioned = lines.filter { !it.positioned && it.text.isNotBlank() }.map { it.text.trim() }
    return (reconstructed + unpositioned).joinToString("\n")
}
