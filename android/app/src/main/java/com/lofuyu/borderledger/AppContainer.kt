package com.lofuyu.borderledger

import com.lofuyu.borderledger.budget.HttpWorkerBudgetApi
import com.lofuyu.borderledger.analysis.HttpWorkerAnalysisApi

import android.content.Context
import com.lofuyu.borderledger.api.CaptureApi
import com.lofuyu.borderledger.api.HttpWorkerOwnerLoginClient
import com.lofuyu.borderledger.api.HttpWorkerOwnerLedgerApi
import com.lofuyu.borderledger.api.HttpWorkerCaptureApi
import com.lofuyu.borderledger.api.HttpWorkerCaptureUploadClient
import com.lofuyu.borderledger.api.OwnerLoginClient
import com.lofuyu.borderledger.auth.ApiEnvironment
import com.lofuyu.borderledger.auth.CaptureCredentialProvider
import com.lofuyu.borderledger.auth.CaptureProfileRepository
import com.lofuyu.borderledger.auth.CaptureOnboardingCoordinator
import com.lofuyu.borderledger.auth.CallbackConfiguration
import com.lofuyu.borderledger.auth.EncryptedCaptureCredentialProvider
import com.lofuyu.borderledger.auth.EncryptedOwnerSessionStore
import com.lofuyu.borderledger.auth.OwnerSessionManager
import com.lofuyu.borderledger.accounts.AccountRepository
import com.lofuyu.borderledger.accounts.HttpWorkerAccountConnectionGateway
import com.lofuyu.borderledger.capture.BankNotificationListenerRuntime
import com.lofuyu.borderledger.capture.BankNotificationIntake
import com.lofuyu.borderledger.capture.CaptureHealthStore
import com.lofuyu.borderledger.capture.CaptureSourceProfileProvider
import com.lofuyu.borderledger.capture.MutableSourceProfileRegistry
import com.lofuyu.borderledger.exports.LedgerExportCoordinator
import com.lofuyu.borderledger.imports.ContentResolverStatementDocumentSource
import com.lofuyu.borderledger.imports.ImportRepository
import com.lofuyu.borderledger.imports.StatementDocumentReader
import com.lofuyu.borderledger.local.AndroidKeyStoreVault
import com.lofuyu.borderledger.local.EncryptedCaptureIntakeStore
import com.lofuyu.borderledger.local.EncryptedLocalDataPolicy
import com.lofuyu.borderledger.local.FileEncryptedRecordStore
import com.lofuyu.borderledger.local.MonitoringController
import com.lofuyu.borderledger.local.EncryptedOwnerReadCache
import com.lofuyu.borderledger.ui.theme.MotionPolicyProvider
import com.lofuyu.borderledger.ui.theme.SharedPreferencesThemePreferences
import com.lofuyu.borderledger.ui.theme.ThemePreferences
import com.lofuyu.borderledger.parser.SourceParserRegistry
import com.lofuyu.borderledger.recurring.HttpWorkerRecurringApi
import com.lofuyu.borderledger.recurring.RecurringRepository
import com.lofuyu.borderledger.review.HttpWorkerReviewRepository
import com.lofuyu.borderledger.review.ReviewRepository
import com.lofuyu.borderledger.ui.accounts.devices.DeviceManagementRepository
import com.lofuyu.borderledger.ui.accounts.devices.DeviceCaptureProfileRepository
import com.lofuyu.borderledger.ui.accounts.devices.HttpWorkerDeviceManagementRepository
import com.lofuyu.borderledger.ui.settings.HttpWorkerReportingPreferencesRepository
import com.lofuyu.borderledger.ui.settings.ReportingPreferencesRepository
import com.lofuyu.borderledger.ui.settings.SharedPreferencesDeviceDisplayPreferences
import com.lofuyu.borderledger.ui.settings.DeviceDisplayPreferencesStore
import com.lofuyu.borderledger.sync.CaptureUploadScheduler
import com.lofuyu.borderledger.sync.WorkManagerCaptureUploadScheduler
import com.lofuyu.borderledger.sync.SchedulingCaptureCredentialProvider
import com.lofuyu.borderledger.sync.CaptureUploadCoordinator

class AppContainer(
    context: Context,
    ownerLoginClient: OwnerLoginClient? = null,
    captureApi: CaptureApi? = null,
    /** Empty by default; production capture stays disabled until approved configuration is injected. */
    captureProfileProvider: CaptureSourceProfileProvider = MutableSourceProfileRegistry(),
    deviceId: String = deviceIdentity(context),
) {
    private val appContext = context.applicationContext
    private val records = FileEncryptedRecordStore(appContext, AndroidKeyStoreVault())
    val bridgeOperations = com.lofuyu.borderledger.react.BridgeOperationJournal(records)
    // A local generation binds operations to this login without exposing or hashing credentials.
    internal val bridgeRecords: com.lofuyu.borderledger.core.SecureRecordPort get() = records

    val ownerSessionStore = EncryptedOwnerSessionStore(records)
    private val storedCaptureCredentialProvider = EncryptedCaptureCredentialProvider(records)
    val captureHealth: CaptureHealthStore = CaptureHealthStore(owner = { ownerSessionManager.currentBinding() })
    val captureProfiles: CaptureSourceProfileProvider = captureProfileProvider
    val captureWork = com.lofuyu.borderledger.auth.CaptureWorkBoundary(storedCaptureCredentialProvider, owner = { ownerSessionManager.currentBinding() }, commit = { binding, block -> ownerSessionManager.commitIfCurrent(binding, block) },
        prepareOwner = { if (ownerSessionManager.state.value is com.lofuyu.borderledger.auth.OwnerSessionState.Restoring) ownerSessionManager.restore() },
        workContext = captureHealth::context)
    val captureIntakeStore = EncryptedCaptureIntakeStore(com.lofuyu.borderledger.auth.CaptureIdentityRecords(records, captureWork))
    val captureIntake = BankNotificationIntake(
        profiles = captureProfiles,
        store = captureIntakeStore,
        health = captureHealth,
        parserFor = { profile -> SourceParserRegistry.parserFor(profile) },
        boundary = captureWork,
    )
    val captureUploadScheduler = WorkManagerCaptureUploadScheduler(
        context = appContext,
        intake = captureIntakeStore,
        credentials = storedCaptureCredentialProvider,
        health = captureHealth,
        boundary = captureWork,
    )
    val captureCredentialProvider: CaptureCredentialProvider = SchedulingCaptureCredentialProvider(
        delegate = storedCaptureCredentialProvider,
        onCredentialSaved = {
            captureHealth.pauseMonitoring()
            captureIntake.activateCurrentConsent()
            captureHealth.resumeAfterConsent()
        },
        onCredentialUsable = { captureUploadScheduler.schedule() },
    )
    private val captureUploadClient = HttpWorkerCaptureUploadClient(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        captureCredentials = captureCredentialProvider,
    )
    val uploadCoordinator = CaptureUploadCoordinator(
        store = captureIntakeStore,
        client = captureUploadClient,
        health = captureHealth,
        boundary = captureWork,
    )
    val notificationListenerRuntime = createCaptureNotificationListenerRuntime(
        profiles = captureProfiles,
        health = captureHealth,
        intake = captureIntake,
        uploadScheduler = captureUploadScheduler,
    )
    val ownerReadCache = EncryptedOwnerReadCache(records)
    val statementDocumentReader = StatementDocumentReader(
        ContentResolverStatementDocumentSource(appContext.contentResolver),
    )
    val localDataPolicy = EncryptedLocalDataPolicy(
        records = records,
        revocationQueue = ownerSessionStore,
        monitoring = object : MonitoringController {
            override suspend fun pauseMonitoring() = captureHealth.pauseMonitoring()
        },
    )
    val themePreferences: ThemePreferences = SharedPreferencesThemePreferences(appContext)
    val deviceDisplayPreferencesStore: DeviceDisplayPreferencesStore = SharedPreferencesDeviceDisplayPreferences(appContext)
    val motionPolicyProvider = MotionPolicyProvider(appContext, deviceDisplayPreferencesStore)

    private val ownerClient = ownerLoginClient ?: HttpWorkerOwnerLoginClient(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        callbackUrl = "${BuildConfig.MOBILE_API_ORIGIN}${BuildConfig.MOBILE_CALLBACK_PATH}",
    )
    val ownerSessionManager = OwnerSessionManager(
        store = ownerSessionStore,
        client = ownerClient,
        captureCredentials = captureCredentialProvider,
        localData = localDataPolicy,
        callbackConfiguration = CallbackConfiguration(
            scheme = BuildConfig.MOBILE_CALLBACK_SCHEME,
            host = BuildConfig.MOBILE_CALLBACK_HOST,
            path = BuildConfig.MOBILE_CALLBACK_PATH,
        ),
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        deviceId = deviceId,
    )
    val analysisRepository = HttpWorkerAnalysisApi(BuildConfig.MOBILE_API_ORIGIN, BuildConfig.MOBILE_ENVIRONMENT, ownerSessionManager)
    val budgetRepository = HttpWorkerBudgetApi(BuildConfig.MOBILE_API_ORIGIN, BuildConfig.MOBILE_ENVIRONMENT, ownerSessionManager)
    val recurringRepository = RecurringRepository(
        HttpWorkerRecurringApi(
            origin = BuildConfig.MOBILE_API_ORIGIN,
            environment = BuildConfig.MOBILE_ENVIRONMENT,
            ownerCredentials = ownerSessionManager,
        ),
    )
    val reviewRepository: ReviewRepository = HttpWorkerReviewRepository(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        ownerCredentials = ownerSessionManager,
    )
    val accountRepository = AccountRepository(
        HttpWorkerAccountConnectionGateway(
            origin = BuildConfig.MOBILE_API_ORIGIN,
            environment = BuildConfig.MOBILE_ENVIRONMENT,
            ownerCredentials = ownerSessionManager,
        ),
    )
    val reportingPreferencesRepository: ReportingPreferencesRepository = HttpWorkerReportingPreferencesRepository(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        ownerCredentials = ownerSessionManager,
    )
    private val ownerDeviceManagementRepository: DeviceManagementRepository = HttpWorkerDeviceManagementRepository(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        ownerCredentials = ownerSessionManager,
    )
    val deviceManagementRepository: DeviceManagementRepository = ownerDeviceManagementRepository
    val captureProfileRepository: CaptureProfileRepository = DeviceCaptureProfileRepository(
        devices = ownerDeviceManagementRepository,
        deviceId = deviceId,
        localProfiles = captureProfiles,
    )
    private val ownerLedgerApi = HttpWorkerOwnerLedgerApi(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        ownerCredentials = ownerSessionManager,
    )
    val ledgerRepository = LedgerRepository(
        ownerSession = ownerSessionManager,
        readCache = ownerReadCache,
        uploadCoordinator = uploadCoordinator,
        health = captureHealth,
        ownerLedgerApi = ownerLedgerApi,
    )
    val importRepository = ImportRepository(
        HttpWorkerImportGateway(
            origin = BuildConfig.MOBILE_API_ORIGIN,
            environment = BuildConfig.MOBILE_ENVIRONMENT,
            ownerCredentials = ownerSessionManager,
        ),
    )
    val exportCoordinator = LedgerExportCoordinator(
        HttpWorkerExportGateway(
            origin = BuildConfig.MOBILE_API_ORIGIN,
            environment = BuildConfig.MOBILE_ENVIRONMENT,
            ownerCredentials = ownerSessionManager,
        ),
    )
    private val captureClient = captureApi ?: HttpWorkerCaptureApi(
        origin = BuildConfig.MOBILE_API_ORIGIN,
        environment = BuildConfig.MOBILE_ENVIRONMENT,
        ownerCredentials = ownerSessionManager,
        captureCredentials = captureCredentialProvider,
    )
    val captureOnboarding = CaptureOnboardingCoordinator(
        ownerSession = ownerSessionManager,
        captureApi = captureClient,
        credentials = captureCredentialProvider,
        profileRepository = captureProfileRepository,
        retainRevocation = localDataPolicy::queueRevocation,
    )
    val apiEnvironment = ApiEnvironment(
        canonicalOrigin = "https://${BuildConfig.MOBILE_CALLBACK_HOST}",
        environment = BuildConfig.MOBILE_ENVIRONMENT,
    )
}

internal fun createCaptureNotificationListenerRuntime(
    profiles: CaptureSourceProfileProvider,
    health: CaptureHealthStore,
    intake: BankNotificationIntake,
    uploadScheduler: CaptureUploadScheduler,
): BankNotificationListenerRuntime = BankNotificationListenerRuntime(
    profiles = profiles,
    health = health,
    intake = intake,
    uploadScheduler = uploadScheduler,
)
