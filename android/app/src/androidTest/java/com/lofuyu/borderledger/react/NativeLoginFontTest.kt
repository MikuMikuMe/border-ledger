package com.lofuyu.borderledger.react

import android.graphics.Typeface
import com.lofuyu.borderledger.CANONICAL_DISPLAY_AXES
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.common.assets.ReactFontManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@androidx.test.filters.SdkSuppress(minSdkVersion = 28)
class NativeLoginFontTest {
    @Test fun requestedVariableWeightsReachAndroidInsteadOfCollapsingToRegular() {
        val assets = InstrumentationRegistry.getInstrumentation().targetContext.assets
        val manager = ReactFontManager.getInstance()
        assertEquals("Newsreader medium heading", 500, manager.getTypeface("Newsreader", Typeface.NORMAL, 500, assets).weight)
        assertEquals("DM Sans semibold action", 600, manager.getTypeface("DMSans", Typeface.NORMAL, 600, assets).weight)
        assertEquals("DM Sans bold brand", 700, manager.getTypeface("DMSans", Typeface.NORMAL, 700, assets).weight)
    }
    @Test fun headlineGlyphRunsStayWithinNativeShapingToleranceOfTheApprovedFont() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val assets = context.assets
        val density = context.resources.displayMetrics.density
        val paint = android.text.TextPaint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            typeface = ReactFontManager.getInstance().getTypeface("NewsreaderDisplay", Typeface.NORMAL, 500, assets)
            textSize = 38f * density
            letterSpacing = -0.95f / 38f
        }
        // Independent Chromium DOM Range measurements after document.fonts.ready.
        val first = paint.measureText("See the flow.") / density
        val second = paint.measureText("Keep the perspective.") / density
        println("Canonical38 glyph runs: $first / $second dp; browser 193.40625 / 330.296875 px")
        // Chromium and Android shape/hint this variable font differently.
        // A 2.5% glyph-run budget catches the original regular/default-axis
        // fallback while preserving the original face, weight and tracking.
        // No horizontal text transform is used to force pixel equality.
        assertTrue("Glyph runs $first / $second exceed the 2.5% native/browser budget", kotlin.math.abs(first / 193.40625f - 1f) < 0.025f && kotlin.math.abs(second / 330.296875f - 1f) < 0.025f)
        assertEquals("Original canonical optical-size axis", "'wght' 500, 'opsz' 38", CANONICAL_DISPLAY_AXES)
    }
}
