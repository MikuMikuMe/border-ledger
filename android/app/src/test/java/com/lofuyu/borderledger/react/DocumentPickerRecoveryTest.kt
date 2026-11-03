package com.lofuyu.borderledger.react

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentPickerRecoveryTest {
    @Test fun initialDispatchRecognizesEveryWealthPickerKind() {
        assertTrue(DocumentPickerRecovery.isPickerKind("wealth_import_picker"))
        assertTrue(DocumentPickerRecovery.isPickerKind("wealth_export_picker"))
        assertTrue(DocumentPickerRecovery.isPickerKind("wealth_template_picker"))
        assertTrue(DocumentPickerRecovery.isExternalKind("wealth_import_picker"))
        assertTrue(DocumentPickerRecovery.isExternalKind("wealth_export_picker"))
        assertTrue(DocumentPickerRecovery.isExternalKind("wealth_template_picker"))
        assertTrue(DocumentPickerRecovery.isExternalKind("plaid"))
        assertFalse(DocumentPickerRecovery.isExternalKind("unrecognized_picker"))
    }

    @Test fun initialDispatchUsesTheMatchingWealthPickerDestination() {
        assertTrue(DocumentPickerRecovery.destinationFor("wealth_import_picker") == DocumentPickerRecovery.Destination.IMPORT)
        assertTrue(DocumentPickerRecovery.destinationFor("wealth_export_picker") == DocumentPickerRecovery.Destination.EXPORT)
        assertTrue(DocumentPickerRecovery.destinationFor("wealth_template_picker") == DocumentPickerRecovery.Destination.EXPORT)
    }

    @Test fun processRecreationRecoversOnlyAnUndeliveredAwaitingPicker() {
        assertTrue(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertTrue(DocumentPickerRecovery.shouldRelaunch("export_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertTrue(DocumentPickerRecovery.shouldRelaunch("wealth_export_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertTrue(DocumentPickerRecovery.shouldRelaunch("wealth_import_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertTrue(DocumentPickerRecovery.shouldRelaunch("wealth_template_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "running", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("plaid", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = true, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = false, resultDelivered = true))
    }

    @Test fun submittedExportCanRetryWithTheSameOperationIdentity() {
        assertTrue(DocumentPickerRecovery.shouldRetryExternal("running"))
        assertTrue(DocumentPickerRecovery.shouldRetryExternal("reconciliation_required"))
        assertFalse(DocumentPickerRecovery.shouldRetryExternal("awaiting_result"))
        assertFalse(DocumentPickerRecovery.shouldRetryExternal("completed"))
        assertTrue(DocumentPickerRecovery.shouldRetainSubmittedHandoff("reconciliation_required"))
        assertFalse(DocumentPickerRecovery.shouldRetainSubmittedHandoff("completed"))
    }

    @Test fun wealthPreviewReadsOnlyFromACompletedCsvOperation() {
        assertTrue(DocumentPickerRecovery.isWealthCsvOperation("wealth_import_picker"))
        assertTrue(DocumentPickerRecovery.isWealthCsvOperation("wealth_csv-preview"))
        assertFalse(DocumentPickerRecovery.isWealthCsvOperation("wealth_export_picker"))
    }
}
