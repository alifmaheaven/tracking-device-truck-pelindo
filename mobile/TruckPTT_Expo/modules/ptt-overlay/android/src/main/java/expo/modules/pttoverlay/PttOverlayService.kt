package expo.modules.pttoverlay

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import expo.modules.kotlin.AppContext

object PttOverlayService {
  private var windowManager: WindowManager? = null
  private var bubbleView: FrameLayout? = null
  private var statusText: TextView? = null
  private var expandedView: FrameLayout? = null
  private var isRecording = false
  private var currentStatus = "Idle"
  private var moduleRef: PttOverlayModule? = null
  private var visible = false

  fun setModule(module: PttOverlayModule?) {
    moduleRef = module
  }

  fun show(activity: Activity) {
    if (visible) return

    windowManager = activity.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val layoutFlag: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
    }

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      layoutFlag,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = 20
    params.y = 300

    // Create bubble container
    bubbleView = FrameLayout(activity).apply {
      layoutParams = FrameLayout.LayoutParams(
        dpToPx(120, activity),
        dpToPx(56, activity)
      )
      setOnTouchListener(bubbleTouchListener)
      addView(createBubbleContent(activity))
    }

    windowManager?.addView(bubbleView, params)
    visible = true
  }

  fun hide(activity: Activity) {
    try {
      bubbleView?.let { windowManager?.removeView(it) }
    } catch (e: Exception) {
      // Already removed
    }
    bubbleView = null
    expandedView = null
    statusText = null
    visible = false
  }

  fun updateStatus(status: String, recording: Boolean) {
    currentStatus = status
    isRecording = recording
    statusText?.let { tv ->
      tv.text = status
      tv.setTextColor(if (recording) Color.parseColor("#EF4444") else Color.parseColor("#FFFFFF"))
    }
    // Update bubble color
    bubbleView?.let { bv ->
      val bg = (bv.getChildAt(0) as? FrameLayout)?.background as? GradientDrawable
      bg?.setColor(Color.parseColor(if (recording) "#EF4444" else "#1E40AF"))
    }
  }

  fun isVisible(): Boolean = visible

  private fun createBubbleContent(ctx: Context): View {
    val container = FrameLayout(ctx).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dpToPx(28f, ctx)
        setColor(Color.parseColor("#1E40AF"))
        setStroke(dpToPx(2f, ctx).toInt(), Color.parseColor("#FFFFFF"))
        alpha = 240 // 0-255; 240 = slightly transparent
      }
      elevation = dpToPx(8f, ctx).toFloat()
    }

    val text = TextView(ctx).apply {
      text = currentStatus
      textSize = 11f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      setPadding(
        dpToPx(8f, ctx).toInt(), 0,
        dpToPx(8f, ctx).toInt(), 0
      )
    }
    statusText = text

    (container as FrameLayout).addView(text, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ))

    return container
  }

  private val bubbleTouchListener = View.OnTouchListener { view, event ->
    var initialX = 0
    var initialY = 0
    var initialTouchX = 0f
    var initialTouchY = 0f
    val clickThreshold = dpToPx(10f, view.context)

    when (event.action) {
      MotionEvent.ACTION_DOWN -> {
        initialX = (view.layoutParams as WindowManager.LayoutParams).x
        initialY = (view.layoutParams as WindowManager.LayoutParams).y
        initialTouchX = event.rawX
        initialTouchY = event.rawY

        // Notify JS on press
        moduleRef?.sendEvent("pttPressIn")

        // Visual feedback
        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor(if (isRecording) "#DC2626" else "#1D4ED8"))
        bg?.alpha = 255

        return@OnTouchListener true
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = (event.rawX - initialTouchX).toInt()
        val dy = (event.rawY - initialTouchY).toInt()
        val params = view.layoutParams as WindowManager.LayoutParams
        params.x = initialX + dx
        params.y = initialY + dy
        windowManager?.updateViewLayout(view, params)
        return@OnTouchListener true
      }
      MotionEvent.ACTION_UP -> {
        // Notify JS on release
        moduleRef?.sendEvent("pttPressOut")

        // If it was a tap (no drag), also fire bubbleTapped
        val dx = Math.abs(event.rawX - initialTouchX)
        val dy = Math.abs(event.rawY - initialTouchY)
        if (dx < clickThreshold && dy < clickThreshold) {
          moduleRef?.sendEvent("bubbleTapped")
        }

        // Restore visual
        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor(if (isRecording) "#EF4444" else "#1E40AF"))
        bg?.alpha = 240

        return@OnTouchListener true
      }
      MotionEvent.ACTION_CANCEL -> {
        moduleRef?.sendEvent("pttPressOut")
        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor(if (isRecording) "#EF4444" else "#1E40AF"))
        bg?.alpha = 240
        return@OnTouchListener true
      }
      else -> false
    }
  }

  private fun dpToPx(dp: Float, context: Context): Float {
    return dp * context.resources.displayMetrics.density
  }
}
