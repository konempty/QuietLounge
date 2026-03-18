import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

const BRAND_COLOR = '#4A6CF7';
const SPLASH_DURATION = 2000;
const FADE_DURATION = 500;

interface SplashOverlayProps {
  onFinish: () => void;
}

function LoadingDot({ index }: { index: number }) {
  const opacity = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const dotDuration = 300;
    const cycleDuration = dotDuration * 3;
    const initialDelay = index * dotDuration;

    Animated.loop(
      Animated.sequence([
        Animated.delay(initialDelay),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.2, duration: 150, useNativeDriver: true }),
        Animated.delay(cycleDuration - dotDuration - initialDelay),
      ]),
    ).start();
  }, [index, opacity]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

export default function SplashOverlay({ onFinish }: SplashOverlayProps) {
  const containerOpacity = useRef(new Animated.Value(1)).current;
  const contentScale = useRef(new Animated.Value(0.5)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 네이티브 스플래시 숨김 (브랜드색 단색 → 같은 색 오버레이, 끊김 없음)
    SplashScreen.hideAsync();

    // Q 로고 + 텍스트 + 점 함께 등장
    Animated.parallel([
      Animated.spring(contentScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // 페이드아웃 후 종료
    const timer = setTimeout(() => {
      Animated.timing(containerOpacity, {
        toValue: 0,
        duration: FADE_DURATION,
        useNativeDriver: true,
      }).start(() => onFinish());
    }, SPLASH_DURATION);

    return () => clearTimeout(timer);
  }, [containerOpacity, contentScale, contentOpacity, onFinish]);

  return (
    <Animated.View style={[styles.container, { opacity: containerOpacity }]}>
      <Animated.View
        style={[
          styles.content,
          { transform: [{ scale: contentScale }], opacity: contentOpacity },
        ]}>
        <View style={styles.logoBox}>
          <Text style={styles.logoText}>Q</Text>
        </View>
        <Text style={styles.brandText}>QuietLounge</Text>
        <View style={styles.dotsRow}>
          <LoadingDot index={0} />
          <LoadingDot index={1} />
          <LoadingDot index={2} />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: BRAND_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: 16,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 40,
    fontWeight: '700',
    color: BRAND_COLOR,
  },
  brandText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
});
