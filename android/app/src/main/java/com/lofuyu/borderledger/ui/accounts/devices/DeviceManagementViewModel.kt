package com.lofuyu.borderledger.ui.accounts.devices

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DeviceManagementState(
    val loading: Boolean = false,
    val devices: List<MobileDevice> = emptyList(),
    val error: String? = null,
    val actionDeviceId: String? = null,
)

class DeviceManagementViewModel(
    private val repository: DeviceManagementRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(DeviceManagementState())
    val state: StateFlow<DeviceManagementState> = _state.asStateFlow()

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        scope.launch {
            runCatching { repository.readDevices() }
                .onSuccess { _state.value = DeviceManagementState(devices = it) }
                .onFailure { _state.value = _state.value.copy(loading = false, error = it.message ?: "Devices are unavailable.") }
        }
    }

    fun revoke(deviceId: String) {
        _state.value = _state.value.copy(actionDeviceId = deviceId, error = null)
        scope.launch {
            runCatching { repository.revoke(deviceId) }
                .onSuccess { load() }
                .onFailure { _state.value = _state.value.copy(actionDeviceId = null, error = it.message ?: "The device could not be revoked.") }
        }
    }
}
