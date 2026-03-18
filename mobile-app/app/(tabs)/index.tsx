import React, { useRef, useCallback, useEffect, useState } from 'react';
import { StyleSheet, BackHandler, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useBlockList } from '@/hooks/useBlockList';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  buildBeforeScript,
  buildAfterScript,
  buildBlockListUpdateScript,
} from '@/utils/webview-scripts';
import type { FilterMode } from '../../shared/types';

const LOUNGE_URL = 'https://lounge.naver.com';

const MOBILE_UA = Platform.select({
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
})!;

export default function LoungeScreen() {
  const webViewRef = useRef<WebView>(null);
  const { blockData, blockUser, updatePersonaCache } = useBlockList();
  const { colors } = useThemeColors();
  const [filterMode, setFilterMode] = useState<FilterMode>('hide');
  const blockDataRef = useRef(blockData);

  useEffect(() => {
    AsyncStorage.getItem('quiet_lounge_filter_mode').then((val) => {
      if (val === 'blur' || val === 'hide') setFilterMode(val);
    });
  }, []);

  useEffect(() => {
    blockDataRef.current = blockData;
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(buildBlockListUpdateScript(blockData));
    }
  }, [blockData]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => handler.remove();
  }, []);

  const handleMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);

        switch (msg.type) {
          case 'BLOCK_USER': {
            const { personaId, nickname } = msg.payload;
            Alert.alert(
              '유저 차단',
              `"${nickname}" 유저를 차단하시겠습니까?`,
              [
                { text: '취소', style: 'cancel' },
                {
                  text: '차단',
                  style: 'destructive',
                  onPress: async () => {
                    await blockUser(personaId || undefined, nickname);
                  },
                },
              ],
            );
            break;
          }
          case 'PERSONA_MAP_UPDATE': {
            const { personaCache: cache } = msg.payload;
            if (cache) {
              for (const [pid, nick] of Object.entries(cache)) {
                await updatePersonaCache(pid, nick as string);
              }
            }
            break;
          }
          case 'PAGE_CHANGED': {
            console.log('[QL] Page changed:', msg.payload.path);
            break;
          }
        }
      } catch (e) {
        console.warn('[QL] Message parse error:', e);
      }
    },
    [blockUser, updatePersonaCache],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <WebView
        ref={webViewRef}
        source={{ uri: LOUNGE_URL }}
        style={styles.webview}
        userAgent={MOBILE_UA}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        injectedJavaScriptBeforeContentLoaded={buildBeforeScript()}
        injectedJavaScript={buildAfterScript(blockData, filterMode)}
        onMessage={handleMessage}
        allowsBackForwardNavigationGestures={true}
        pullToRefreshEnabled={true}
        startInLoadingState={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});
