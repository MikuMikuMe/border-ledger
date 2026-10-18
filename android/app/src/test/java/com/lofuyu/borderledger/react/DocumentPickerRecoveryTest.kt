package com.lofuyu.borderledger.react

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DocumentPickerRecoveryTest {
    @Test fun processRecreationRecoversOnlyAnUndeliveredAwaitingPicker() {
        assertTrue(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertTrue(DocumentPickerRecovery.shouldRelaunch("export_picker", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "running", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("plaid", "awaiting_result", activeInProcess = false, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = true, resultDelivered = false))
        assertFalse(DocumentPickerRecovery.shouldRelaunch("import_picker", "awaiting_result", activeInProcess = false, resultDelivered = true))
    }
}
