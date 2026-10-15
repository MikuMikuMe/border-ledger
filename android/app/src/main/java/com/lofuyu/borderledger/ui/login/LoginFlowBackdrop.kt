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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import com.lofuyu.borderledger.ui.theme.MotionPolicy
import kotlinx.coroutines.isActive

/** Two slow ink ribbons; controls remain outside this canvas and never drift. */
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
        val p = progress.value
        val drift = if (motionPolicy.allowsContinuousMotion) p else 0f
        val first = Path().apply {
            moveTo(size.width * 0.02f, size.height * (0.27f + drift * 0.02f))
            cubicTo(
                size.width * 0.28f,
                size.height * (0.05f + drift * 0.08f),
                size.width * 0.57f,
                size.height * (0.46f - drift * 0.10f),
                size.width * 1.06f,
                size.height * (0.20f + drift * 0.07f),
            )
        }
        val second = Path().apply {
            moveTo(size.width * -0.03f, size.height * (0.43f - drift * 0.04f))
            cubicTo(
                size.width * 0.34f,
                size.height * (0.72f - drift * 0.06f),
                size.width * 0.64f,
                size.height * (0.12f + drift * 0.10f),
                size.width * 1.08f,
                size.height * (0.48f - drift * 0.06f),
            )
        }
        drawPath(
            path = first,
            color = colors.primary.copy(alpha = 0.40f),
            style = Stroke(width = 2.4f, cap = StrokeCap.Round),
        )
        drawPath(
            path = second,
            color = colors.secondary.copy(alpha = 0.40f),
            style = Stroke(width = 1.7f, cap = StrokeCap.Round),
        )
        drawLine(
            color = colors.outline.copy(alpha = 0.28f),
            start = Offset(0f, size.height * 0.52f),
            end = Offset(size.width, size.height * 0.52f),
            strokeWidth = 1f,
        )
    }
}

private const val FLOW_CYCLE_MILLIS = 18_000
