package com.lofuyu.borderledger.ui.login

import com.lofuyu.borderledger.auth.LoginLaunch
import com.lofuyu.borderledger.auth.OwnerSessionManager
import com.lofuyu.borderledger.auth.OwnerSessionState
import kotlinx.coroutines.flow.StateFlow

/** Small state adapter; network and persistence policy remain in OwnerSessionManager. */
class LoginViewModel(private val sessions: OwnerSessionManager) {
    val state: StateFlow<OwnerSessionState> = sessions.state

    suspend fun begin(staySignedIn: Boolean, pendingDestination: String?): LoginLaunch =
        sessions.beginLogin(staySignedIn, pendingDestination)

    suspend fun signOut() = sessions.signOut()
}
