package com.lofuyu.borderledger.ui.settings

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SettingsState(
    val loading: Boolean = false,
    val preferences: ReportingPreferences? = null,
    val saving: Boolean = false,
    val conflictRevision: Int? = null,
    val error: String? = null,
)

class SettingsViewModel(
    private val repository: ReportingPreferencesRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    fun load() {
        _state.value = _state.value.copy(loading = true, error = null)
        scope.launch {
            runCatching { repository.read() }
                .onSuccess { _state.value = SettingsState(preferences = it) }
                .onFailure { _state.value = _state.value.copy(loading = false, error = it.message ?: "Preferences are unavailable.") }
        }
    }

    fun save(update: ReportingPreferencesUpdate) {
        val current = _state.value.preferences ?: return
        _state.value = _state.value.copy(saving = true, conflictRevision = null, error = null)
        scope.launch {
            runCatching { repository.update(current.revision, update) }
                .onSuccess { _state.value = SettingsState(preferences = it) }
                .onFailure { error ->
                    if (error is ReportingPreferencesRepository.RevisionConflict) {
                        _state.value = _state.value.copy(saving = false, conflictRevision = error.currentRevision, error = error.message)
                    } else {
                        _state.value = _state.value.copy(saving = false, error = error.message ?: "Preferences could not be saved.")
                    }
                }
        }
    }
}
