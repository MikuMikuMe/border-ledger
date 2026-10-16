package com.lofuyu.borderledger.ui.login

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LoginThreadGeometryTest {
    @Test
    fun `reduced motion selects a deterministic static phase`() {
        assertEquals(0f, loginThreadPhase(progress = 0.63f, allowMotion = false), 0f)
        assertEquals(0.63f, loginThreadPhase(progress = 0.63f, allowMotion = true), 0f)
    }

    @Test
    fun `thread geometry is finite and spans beyond the screen edges`() {
        val width = 412f
        val height = 915f
        val geometry = FloatArray(LOGIN_THREAD_COUNT * LOGIN_THREAD_STRIDE)

        updateLoginThreadGeometry(geometry, width, height, progress = 0.37f)

        assertTrue(geometry.all { it.isFinite() })
        assertTrue((0 until LOGIN_THREAD_COUNT).all { index ->
            val offset = index * LOGIN_THREAD_STRIDE
            geometry[offset + THREAD_START_X] < 0f && geometry[offset + THREAD_END_X] > width
        })
        assertTrue((0 until LOGIN_THREAD_COUNT).all { index ->
            val intensity = geometry[index * LOGIN_THREAD_STRIDE + THREAD_INTENSITY]
            intensity in 0f..1f
        })
    }

    @Test
    fun `thread positions meet at the animation loop boundary`() {
        val start = FloatArray(LOGIN_THREAD_COUNT * LOGIN_THREAD_STRIDE)
        val end = FloatArray(LOGIN_THREAD_COUNT * LOGIN_THREAD_STRIDE)
        updateLoginThreadGeometry(start, 412f, 915f, progress = 0f)
        updateLoginThreadGeometry(end, 412f, 915f, progress = 1f)

        start.indices.forEach { index -> assertEquals(start[index], end[index], 0.01f) }
    }
}

