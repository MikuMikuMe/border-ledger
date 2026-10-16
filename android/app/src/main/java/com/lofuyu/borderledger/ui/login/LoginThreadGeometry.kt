package com.lofuyu.borderledger.ui.login

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin

/** Fixed path count keeps the animated background inexpensive and predictable. */
internal const val LOGIN_THREAD_COUNT = 88
internal const val LOGIN_THREAD_STRIDE = 9

internal const val THREAD_START_X = 0
internal const val THREAD_START_Y = 1
internal const val THREAD_CONTROL_1_X = 2
internal const val THREAD_CONTROL_1_Y = 3
internal const val THREAD_CONTROL_2_X = 4
internal const val THREAD_CONTROL_2_Y = 5
internal const val THREAD_END_X = 6
internal const val THREAD_END_Y = 7
internal const val THREAD_INTENSITY = 8

/** Reduced motion and battery saver keep a composed but immobile artwork frame. */
internal fun loginThreadPhase(progress: Float, allowMotion: Boolean): Float =
    if (allowMotion) progress.coerceIn(0f, 1f) else 0f

/** Writes 88 cubic-thread control points into a caller-owned buffer, avoiding frame allocations. */
internal fun updateLoginThreadGeometry(
    geometry: FloatArray,
    width: Float,
    height: Float,
    progress: Float,
) {
    require(geometry.size >= LOGIN_THREAD_COUNT * LOGIN_THREAD_STRIDE)
    require(width >= 0f && height >= 0f)

    val boundedProgress = progress.coerceIn(0f, 1f)
    val cycleProgress = if (boundedProgress == 1f) 0f else boundedProgress
    val phase = cycleProgress * TWO_PI

    repeat(LOGIN_THREAD_COUNT) { index ->
        val position = index / (LOGIN_THREAD_COUNT - 1f)
        val strandPhase = position * 4.8f
        val firstWave = sin(phase + strandPhase)
        val secondWave = cos(phase * 0.82f + strandPhase * 0.72f + 0.64f)
        val offset = index * LOGIN_THREAD_STRIDE

        geometry[offset + THREAD_START_X] = -width * 0.055f
        geometry[offset + THREAD_START_Y] = height * (0.035f + position * 0.93f + firstWave * 0.012f)
        geometry[offset + THREAD_CONTROL_1_X] = width * 0.29f
        geometry[offset + THREAD_CONTROL_1_Y] = height * (0.19f + position * 0.69f + firstWave * 0.104f)
        geometry[offset + THREAD_CONTROL_2_X] = width * 0.72f
        geometry[offset + THREAD_CONTROL_2_Y] = height * (0.72f + position * 0.18f + secondWave * 0.092f)
        geometry[offset + THREAD_END_X] = width * 1.055f
        geometry[offset + THREAD_END_Y] = height * (0.13f + position * 0.84f + secondWave * 0.035f)

        // Keep most strands hushed; a small central band carries enough light to read as silk.
        val focus = (1f - abs(position - 0.43f) * 1.55f).coerceIn(0f, 1f)
        geometry[offset + THREAD_INTENSITY] = 0.12f + focus * 0.43f
    }
}

private const val TWO_PI = 6.283185307179586f

