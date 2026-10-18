package com.lofuyu.borderledger.auth

fun interface OwnerCredentialProvider {
    suspend fun accessToken(): String?
}
