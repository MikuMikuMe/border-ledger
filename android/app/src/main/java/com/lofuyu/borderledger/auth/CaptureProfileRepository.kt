package com.lofuyu.borderledger.auth

const val CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE =
    "Import-only: source setup unavailable. An approved owner mapping and a verified local source profile are required before capture can be authorized."

enum class CaptureSourceSetupStatus {
    Available,
    Unavailable,
}

enum class CaptureProfileUnavailableReason {
    DeviceMappingUnavailable,
    DeviceNotPaired,
    DeviceRevoked,
    NoSourceMapping,
    SourceProfileUnavailable,
    MappingNotSupported,
}

sealed interface CaptureProfileLoadResult {
    data class Available(
        val profiles: List<CaptureSourceProfile>,
        val revision: Int,
    ) : CaptureProfileLoadResult

    data class Unavailable(
        val reason: CaptureProfileUnavailableReason,
        val message: String = CAPTURE_SOURCE_SETUP_UNAVAILABLE_MESSAGE,
    ) : CaptureProfileLoadResult
}

interface CaptureProfileRepository {
    suspend fun load(): CaptureProfileLoadResult
}
