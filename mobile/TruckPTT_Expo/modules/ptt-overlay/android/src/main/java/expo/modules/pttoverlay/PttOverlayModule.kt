package expo.modules.pttoverlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.core.interfaces.ActivityProvider

class PttOverlayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PttOverlay")

    Events("pttPressIn", "pttPressOut", "bubbleTapped")

    OnCreate {
      PttOverlayService.setModule(this@PttOverlayModule)
    }

    OnDestroy {
      PttOverlayService.setModule(null)
    }

    AsyncFunction("show") {
      val activity = appContext.legacyModule<ActivityProvider>()?.currentActivity
      if (activity != null) {
        PttOverlayService.show(activity)
      }
    }

    AsyncFunction("hide") {
      val activity = appContext.legacyModule<ActivityProvider>()?.currentActivity
      if (activity != null) {
        PttOverlayService.hide(activity)
      }
    }

    AsyncFunction("updateStatus") { status: String, recording: Boolean ->
      PttOverlayService.updateStatus(status, recording)
    }

    AsyncFunction("isOverlayPermissionGranted") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Settings.canDrawOverlays(ctx)
      } else {
        true
      }
    }

    AsyncFunction("requestOverlayPermission") {
      val activity = appContext.legacyModule<ActivityProvider>()?.currentActivity
        ?: return@AsyncFunction
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        if (!Settings.canDrawOverlays(activity)) {
          val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:${activity.packageName}")
          )
          intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          activity.startActivity(intent)
        }
      }
    }

    AsyncFunction("isVisible") {
      PttOverlayService.isVisible()
    }
  }
}
