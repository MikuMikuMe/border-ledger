package com.lofuyu.borderledger.ui.login

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.lofuyu.borderledger.ui.theme.MotionPolicy
import kotlinx.coroutines.isActive

/** A slow, full-bleed field of ink threads; sign-in controls remain outside the canvas. */
@Composable
fun LoginFlowBackdrop(
    modifier: Modifier = Modifier,
    motionPolicy: MotionPolicy,
) {
    val progress = remember { Animatable(0f) }
    val geometry = remember { FloatArray(LOGIN_THREAD_COUNT * LOGIN_THREAD_STRIDE) }
    val path = remember { Path() }
    val forestWash = remember {
        Brush.verticalGradient(
            colors = listOf(Color(0xFF061A14), Color(0xFF0A241B), Color(0xFF071B15)),
        )
    }

    LaunchedEffect(motionPolicy.allowsContinuousMotion) {
        if (!motionPolicy.allowsContinuousMotion) {
            progress.snapTo(0f)
        } else {
            while (isActive) {
                progress.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(
                        durationMillis = THREAD_CYCLE_MILLIS,
                        easing = LinearEasing,
                    ),
                )
                // Geometry maps 1 back to 0 exactly, so this reset is visually seamless.
                progress.snapTo(0f)
            }
        }
    }

    Canvas(modifier = modifier) {
        drawRect(brush = forestWash)

        val glowCenter = Offset(size.width * 0.78f, size.height * 0.19f)
        val glowRadius = size.maxDimension * 0.62f
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(Color(0xFF2D6B4D).copy(alpha = 0.46f), Color.Transparent),
                center = glowCenter,
                radius = glowRadius,
            ),
            radius = glowRadius,
            center = glowCenter,
        )

        val phase = loginThreadPhase(
            progress = progress.value,
            allowMotion = motionPolicy.allowsContinuousMotion,
        )
        updateLoginThreadGeometry(
            geometry = geometry,
            width = size.width,
            height = size.height,
            progress = phase,
        )

        repeat(LOGIN_THREAD_COUNT) { index ->
            val offset = index * LOGIN_THREAD_STRIDE
            path.reset()
            path.moveTo(geometry[offset + THREAD_START_X], geometry[offset + THREAD_START_Y])
            path.cubicTo(
                geometry[offset + THREAD_CONTROL_1_X], geometry[offset + THREAD_CONTROL_1_Y],
                geometry[offset + THREAD_CONTROL_2_X], geometry[offset + THREAD_CONTROL_2_Y],
                geometry[offset + THREAD_END_X], geometry[offset + THREAD_END_Y],
            )

            val isChampagneThread = index % 13 == 6
            val color = if (isChampagneThread) CHAMPAGNE_THREAD else JADE_THREAD
            val baseOpacity = if (isChampagneThread) 0.56f else 0.40f
            val intensity = geometry[offset + THREAD_INTENSITY]
            drawPath(
                path = path,
                color = color.copy(alpha = baseOpacity * intensity),
                style = Stroke(
                    width = if (isChampagneThread) 1.05.dp.toPx() else 0.72.dp.toPx(),
                    cap = StrokeCap.Round,
                ),
            )
        }
    }
}

private const val THREAD_CYCLE_MILLIS = 30_000
private val JADE_THREAD = Color(0xFFB8D8C2)
private val CHAMPAGNE_THREAD = Color(0xFFE9D6AF)

