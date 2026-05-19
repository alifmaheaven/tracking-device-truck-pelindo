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
    if (activity.isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && activity.isDestroyed)) return

    val appContext = activity.applicationContext
    windowManager = appContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    // Set size to 80dp (half of the previous 160dp)
    val sizePx = dpToPx(80f, appContext).toInt()

    val layoutFlag: Int = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    } else {
      @Suppress("DEPRECATION")
      WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
    }

    // Explicit square dimensions to ensure perfect circle
    val params = WindowManager.LayoutParams(
      sizePx,
      sizePx,
      layoutFlag,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
      WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
      WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = 20
    params.y = 400

    // Create bubble container
    bubbleView = FrameLayout(appContext).apply {
      layoutParams = WindowManager.LayoutParams(sizePx, sizePx, layoutFlag, 0, PixelFormat.TRANSLUCENT)
      setOnTouchListener(bubbleTouchListener)
      addView(createBubbleContent(appContext, sizePx))
    }

    try {
      windowManager?.addView(bubbleView, params)
      visible = true
    } catch (e: Exception) {
      visible = false
      bubbleView = null
    }
  }

  fun hide(activity: Activity) {
    try {
      bubbleView?.let { 
        val wm = windowManager ?: (activity.applicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
        wm.removeView(it) 
      }
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
      tv.text = if (recording) "BICARA" else "TEKAN PTT"
      tv.setTextColor(Color.WHITE)
    }
    // Update bubble color
    bubbleView?.let { bv ->
      val bg = (bv.getChildAt(0) as? FrameLayout)?.background as? GradientDrawable
      bg?.setColor(Color.parseColor(if (recording) "#EF4444" else "#1E40AF"))
    }
  }

  fun isVisible(): Boolean = visible

  private fun createBubbleContent(ctx: Context, sizePx: Int): View {
    val container = FrameLayout(ctx).apply {
      layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#1E40AF"))
        setStroke(dpToPx(4f, ctx).toInt(), Color.parseColor("#FFFFFF"))
        alpha = 220 // Slightly less transparent now that it's smaller
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        elevation = dpToPx(10f, ctx)
      }
    }

    val text = TextView(ctx).apply {
      text = "TEKAN PTT"
      textSize = 12f 
      setAllCaps(true)
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      setTypeface(null, android.graphics.Typeface.BOLD)
    }
    statusText = text

    container.addView(text, FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ))

    return container
  }

  // Drag state
  private var dragInitialX = 0
  private var dragInitialY = 0
  private var dragInitialTouchX = 0f
  private var dragInitialTouchY = 0f

  private val bubbleTouchListener = View.OnTouchListener { view, event ->
    val clickThreshold = dpToPx(15f, view.context)

    when (event.action) {
      MotionEvent.ACTION_DOWN -> {
        dragInitialX = (view.layoutParams as WindowManager.LayoutParams).x
        dragInitialY = (view.layoutParams as WindowManager.LayoutParams).y
        dragInitialTouchX = event.rawX
        dragInitialTouchY = event.rawY

        moduleRef?.sendEvent("pttPressIn")

        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor("#DC2626")) 
        bg?.alpha = 255

        return@OnTouchListener true
      }
      MotionEvent.ACTION_MOVE -> {
        val dx = (event.rawX - dragInitialTouchX).toInt()
        val dy = (event.rawY - dragInitialTouchY).toInt()
        val params = view.layoutParams as WindowManager.LayoutParams
        params.x = dragInitialX + dx
        params.y = dragInitialY + dy
        windowManager?.updateViewLayout(view, params)
        return@OnTouchListener true
      }
      MotionEvent.ACTION_UP -> {
        moduleRef?.sendEvent("pttPressOut")

        val dx = Math.abs(event.rawX - dragInitialTouchX)
        val dy = Math.abs(event.rawY - dragInitialTouchY)
        if (dx < clickThreshold && dy < clickThreshold) {
          moduleRef?.sendEvent("bubbleTapped")
        }

        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor(if (isRecording) "#EF4444" else "#1E40AF"))
        bg?.alpha = 220

        return@OnTouchListener true
      }
      MotionEvent.ACTION_CANCEL -> {
        moduleRef?.sendEvent("pttPressOut")
        val bg = (view as? FrameLayout)?.getChildAt(0)?.let { child ->
          (child as? FrameLayout)?.background as? GradientDrawable
        }
        bg?.setColor(Color.parseColor(if (isRecording) "#EF4444" else "#1E40AF"))
        bg?.alpha = 220
        return@OnTouchListener true
      }
      else -> false
    }
  }

  private fun dpToPx(dp: Float, context: Context): Float {
    return dp * context.resources.displayMetrics.density
  }
}
