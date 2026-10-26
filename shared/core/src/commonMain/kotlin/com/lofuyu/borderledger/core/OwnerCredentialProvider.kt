package com.lofuyu.borderledger.auth

fun interface OwnerCredentialProvider {
    suspend fun accessToken(): String?
    fun currentBinding(): SessionBinding? = null
    suspend fun accessTokenFor(expected: SessionBinding): String? = null
}
