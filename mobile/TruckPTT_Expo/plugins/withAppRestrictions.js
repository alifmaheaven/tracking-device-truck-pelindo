const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Inject app_restrictions.xml into android/app/src/main/res/xml/
 * and add <meta-data android:name="android.content.APP_RESTRICTIONS" /> to manifest.
 * This is the standard Android AppConfig mechanism used by Knox Manage.
 */
const withAppRestrictions = (config) => {
  // 1. Write app_restrictions.xml + ensure strings.xml has required entries
  config = withDangerousMod(config, [
    'android',
    (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const resXmlDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'xml');
      const resValuesDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'values');

      // 1a. Ensure res/xml/ exists and write app_restrictions.xml
      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      const restrictionsXml = `<?xml version="1.0" encoding="utf-8"?>
<restrictions xmlns:android="http://schemas.android.com/apk/res/android">
    <restriction
        android:key="serial_number"
        android:title="@string/knox_sn_title"
        android:restrictionType="string"
        android:description="@string/knox_sn_description"
        android:defaultValue="" />
</restrictions>
`;

      fs.writeFileSync(path.join(resXmlDir, 'app_restrictions.xml'), restrictionsXml);

      // 1b. Ensure strings.xml contains knox_sn_title and knox_sn_description
      if (!fs.existsSync(resValuesDir)) {
        fs.mkdirSync(resValuesDir, { recursive: true });
      }
      const stringsPath = path.join(resValuesDir, 'strings.xml');
      let stringsContent = '';
      if (fs.existsSync(stringsPath)) {
        stringsContent = fs.readFileSync(stringsPath, 'utf8');
      } else {
        stringsContent = '<resources>\n  <string name="app_name">Push To Talk!</string>\n</resources>\n';
      }

      const titleKey = '<string name="knox_sn_title"';
      const descKey = '<string name="knox_sn_description"';

      let updated = stringsContent;
      if (!updated.includes(titleKey)) {
        updated = updated.replace(
          '</resources>',
          '  <string name="knox_sn_title">Serial Number (Auto-Login)</string>\n</resources>'
        );
      }
      if (!updated.includes(descKey)) {
        updated = updated.replace(
          '</resources>',
          '  <string name="knox_sn_description">Serial Number device untuk auto-login TruckPTT. Inject dari Knox Manage console.</string>\n</resources>'
        );
      }

      if (updated !== stringsContent) {
        fs.writeFileSync(stringsPath, updated);
      }

      return modConfig;
    },
  ]);

  // 2. Add <meta-data> to AndroidManifest application tag
  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application[0];

    if (!application['meta-data']) {
      application['meta-data'] = [];
    }

    const hasRestrictions = application['meta-data'].some(
      (m) => m['$']['android:name'] === 'android.content.APP_RESTRICTIONS'
    );

    if (!hasRestrictions) {
      application['meta-data'].push({
        '$': {
          'android:name': 'android.content.APP_RESTRICTIONS',
          'android:resource': '@xml/app_restrictions',
        },
      });
    }

    return manifestConfig;
  });

  return config;
};

module.exports = withAppRestrictions;