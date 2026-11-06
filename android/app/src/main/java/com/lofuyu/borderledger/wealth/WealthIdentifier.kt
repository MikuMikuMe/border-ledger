package com.lofuyu.borderledger.wealth

import java.util.UUID

internal object WealthIdentifier {
    fun create(): String = UUID.randomUUID().toString()
}
