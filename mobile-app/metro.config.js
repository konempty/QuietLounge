const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// shared/ 디렉토리를 watchFolder로 추가
const sharedDir = path.resolve(__dirname, '../shared');
config.watchFolders = [sharedDir];

// shared/ 모듈 해석을 위한 nodeModulesPaths
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
];

module.exports = config;
