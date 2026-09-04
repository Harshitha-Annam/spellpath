module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Must be listed last (Reanimated 4 / Worklets).
    'react-native-worklets/plugin',
  ],
};
