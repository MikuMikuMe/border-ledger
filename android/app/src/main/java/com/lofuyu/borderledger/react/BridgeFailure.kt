package com.lofuyu.borderledger.react

internal class BridgeFailure(val code: String): Exception()
/** Thrown only by a boundary that proves no backend request was submitted. */
internal class BridgeLocalFailure: Exception()
