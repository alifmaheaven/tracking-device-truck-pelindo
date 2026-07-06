const { withAndroidManifest, withPlugins } = require('@expo/config-plugins');
const withAppRestrictions = require('./withAppRestrictions');

const withPttService = (config) => {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    
    // Find existing notifee service or add it
    let service = mainApplication.service?.find(
      (s) => s['$']['android:name'] === 'app.notifee.core.ForegroundService'
    );

    if (!service) {
      if (!mainApplication.service) mainApplication.service = [];
      service = {
        '$': {
          'android:name': 'app.notifee.core.ForegroundService',
          'android:exported': 'false',
        },
      };
      mainApplication.service.push(service);
    }

    // Set foregroundServiceType
    service['$']['android:foregroundServiceType'] = 'microphone|mediaPlayback';
    service['$']['tools:replace'] = 'android:foregroundServiceType';
    
    // Add tools namespace if missing
    if (!config.modResults.manifest['$']['xmlns:tools']) {
      config.modResults.manifest['$']['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    return config;
  });
};

module.exports = (config) => {
  return withPlugins(config, [withPttService, withAppRestrictions]);
};