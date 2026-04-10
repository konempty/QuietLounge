const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withProguard(config) {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const entries = [
      { type: 'property', key: 'android.enableMinifyInReleaseBuilds', value: 'true' },
      { type: 'property', key: 'android.enableShrinkResourcesInReleaseBuilds', value: 'true' },
    ];

    for (const entry of entries) {
      const idx = props.findIndex((p) => p.key === entry.key);
      if (idx >= 0) {
        props[idx] = entry;
      } else {
        props.push(entry);
      }
    }

    return config;
  });
};
