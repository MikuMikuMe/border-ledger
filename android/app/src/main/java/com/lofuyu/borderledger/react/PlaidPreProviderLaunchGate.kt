package com.lofuyu.borderledger.react

import kotlinx.coroutines.Job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Serializes cancellation against the final, durable step immediately before LinkKit opens. */
internal class PlaidPreProviderLaunchGate {
    private val mutex = Mutex()
    private val jobs = mutableMapOf<String, Job>()

    suspend fun register(operationId: String, job: Job) = mutex.withLock {
        check(jobs.putIfAbsent(operationId, job) == null) { "A Plaid preparation job already exists." }
    }

    suspend fun beginProviderLaunch(
        operationId: String,
        job: Job,
        persistMayBeOpen: suspend () -> Unit,
    ): Boolean = mutex.withLock {
        if (jobs[operationId] !== job || !job.isActive) return@withLock false
        persistMayBeOpen()
        jobs.remove(operationId)
        true
    }

    /** Removes and cancels only work that has not crossed the provider-launch marker. */
    suspend fun cancelBeforeProviderLaunch(operationId: String): Job? = mutex.withLock {
        jobs.remove(operationId)?.also { it.cancel() }
    }

    suspend fun isPreparing(operationId: String): Boolean = mutex.withLock { operationId in jobs }

    suspend fun remove(operationId: String, job: Job) = mutex.withLock {
        if (jobs[operationId] === job) jobs.remove(operationId)
    }
}
