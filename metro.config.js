const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const baseMinifierConfig = config.transformer?.minifierConfig ?? {};

config.transformer = {
  ...config.transformer,
  minifierConfig: {
    ...baseMinifierConfig,
    mangle: {
      ...(baseMinifierConfig.mangle ?? {}),
      toplevel: true
    },
    compress: {
      ...(baseMinifierConfig.compress ?? {}),
      drop_console: true,
      drop_debugger: true,
      passes: 2
    },
    output: {
      ...(baseMinifierConfig.output ?? {}),
      comments: false,
      ascii_only: true
    }
  }
};

module.exports = config;

