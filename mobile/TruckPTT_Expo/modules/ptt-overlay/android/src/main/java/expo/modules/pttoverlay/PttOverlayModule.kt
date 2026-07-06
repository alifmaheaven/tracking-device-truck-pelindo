package expo.modules.pttoverlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.core.interfaces.ActivityProvider

class PttOverlayModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PttOverlay")

    Events("pttPressIn", "pttPressOut", "bubbleTapped", "restrictionsChanged")

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
      null
    }

    AsyncFunction("hide") {
      val activity = appContext.legacyModule<ActivityProvider>()?.currentActivity
      if (activity != null) {
        PttOverlayService.hide(activity)
      }
      null
    }

    AsyncFunction("updateStatus") { status: String, recording: Boolean ->
      PttOverlayService.updateStatus(status, recording)
      null
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
        ?: return@AsyncFunction null
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
      null
    }

    AsyncFunction("isVisible") {
      PttOverlayService.isVisible()
    }

    AsyncFunction("minimizeApp") {
      val activity = appContext.legacyModule<ActivityProvider>()?.currentActivity
      activity?.moveTaskToBack(true)
      null
    }

    // ---- Knox AppConfig: Read managed configuration (injected by Knox Manage) ----
    AsyncFunction("getManagedConfig") { key: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val restrictionsManager = ctx.getSystemService(Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager
      val bundle: Bundle = restrictionsManager.applicationRestrictions
      if (key == "*") {
        val map = mutableMapOf<String, String>()
        for (k in bundle.keySet()) {
          map[k] = bundle.get(k)?.toString() ?: ""
        }
        return@AsyncFunction map
      }
      val value = bundle.getString(key, null)
      return@AsyncFunction value
    }

    // ---- Knox AppConfig: Register live receiver for config changes (no restart needed) ----
    AsyncFunction("registerRestrictionsReceiver") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      val filter = IntentFilter(Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED)
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action == Intent.ACTION_APPLICATION_RESTRICTIONS_CHANGED) {
            val rm = ctx.getSystemService(Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager
            val b = rm.applicationRestrictions
            val sn = b.getString("serial_number", null)
            if (sn != null && sn.isNotEmpty()) {
              this@PttOverlayModule.sendEvent("restrictionsChanged", mapOf("serial_number" to sn))
            }
          }
        }
      }
      ctx.registerReceiver(receiver, filter)
      true
    }
  }
}
