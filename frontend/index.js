/**
 * @format
 */

import 'react-native-gesture-handler';

import { AppRegistry, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import { name as appName } from './app.json';

function Root() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <App />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

AppRegistry.registerComponent(appName, () => Root);
