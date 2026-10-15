package com.lofuyu.borderledger.ui.login

import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Size
import com.lofuyu.borderledger.ui.theme.MotionPolicy
import kotlinx.coroutines.isActive
import kotlin.math.cos
import kotlin.math.sin

/** Slow brand shapes and ink ribbons; controls remain outside this canvas and never drift. */
@Composable
fun LoginFlowBackdrop(
    modifier: Modifier = Modifier,
    motionPolicy: MotionPolicy,
) {
    val colors = MaterialTheme.colorScheme
    val progress = remember { Animatable(0f) }
    LaunchedEffect(motionPolicy.allowsContinuousMotion) {
        if (!motionPolicy.allowsContinuousMotion) {
            progress.snapTo(0f)
        } else {
            while (isActive) {
                progress.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(
                        durationMillis = FLOW_CYCLE_MILLIS,
                        easing = CubicBezierEasing(0.16f, 0f, 0.3f, 1f),
                    ),
                )
                progress.snapTo(0f)
            }
        }
    }

    Canvas(modifier = modifier) {
        val phase = if (motionPolicy.allowsContinuousMotion) {
            progress.value * (2f * Math.PI.toFloat())
        } else {
            0f
        }
        val drift = sin(phase)
        val counterDrift = cos(phase * 0.82f + 0.8f)
        val orbit = size.minDimension

        drawCircle(
            color = colors.primaryContainer.copy(alpha = 0.72f),
            radius = orbit * 0.26f,
            center = Offset(
                x = size.width * (0.90f + drift * 0.06f),
                y = size.height * (0.16f + counterDrift * 0.035f),
            ),
        )
        drawCircle(
            color = colors.secondaryContainer.copy(alpha = 0.66f),
            radius = orbit * 0.20f,
            center = Offset(
                x = size.width * (0.08f + counterDrift * 0.045f),
                y = size.height * (0.79f + drift * 0.035f),
            ),
        )
        drawRoundRect(
            color = colors.primary.copy(alpha = 0.10f),
            topLeft = Offset(size.width * 0.63f, size.height * 0.44f),
            size = Size(size.width * 0.54f, size.height * 0.20f),
            cornerRadius = CornerRadius(orbit * 0.12f),
            style = Stroke(width = 1.5f),
        )
        val first = Path().apply {
            moveTo(size.width * 0.02f, size.height * (0.27f + drift * 0.04f))
            cubicTo(
                size.width * 0.28f,
                size.height * (0.05f + drift * 0.12f),
                size.width * 0.57f,
                size.height * (0.46f - drift * 0.14f),
                size.width * 1.06f,
                size.height * (0.20f + drift * 0.10f),
            )
        }
        val second = Path().apply {
            moveTo(size.width * -0.03f, size.height * (0.43f - counterDrift * 0.07f))
            cubicTo(
                size.width * 0.34f,
                size.height * (0.72f - counterDrift * 0.10f),
                size.width * 0.64f,
                size.height * (0.12f + counterDrift * 0.15f),
                size.width * 1.08f,
                size.height * (0.48f - counterDrift * 0.09f),
            )
        }
        drawPath(
            path = first,
            color = colors.primary.copy(alpha = 0.58f),
            style = Stroke(width = 2.8f, cap = StrokeCap.Round),
        )
        drawPath(
            path = second,
            color = colors.secondary.copy(alpha = 0.58f),
            style = Stroke(width = 2.1f, cap = StrokeCap.Round),
        )
        drawLine(
            color = colors.outline.copy(alpha = 0.46f),
            start = Offset(0f, size.height * 0.52f),
            end = Offset(size.width, size.height * 0.52f),
            strokeWidth = 1f,
        )
    }
}

private const val FLOW_CYCLE_MILLIS = 14_000
