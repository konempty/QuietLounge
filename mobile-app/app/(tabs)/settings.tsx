import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Switch,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import { useBlockList } from '@/hooks/useBlockList';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useMyStats } from '@/hooks/useMyStats';
import Colors from '@/constants/Colors';

export default function SettingsScreen() {
  const { exportJSON, importJSON, clearAll, allBlocked, filterMode, setFilterMode } = useBlockList();
  const { colors } = useThemeColors();
  const { stats: myStats, loading: statsLoading, refresh: refreshStats } = useMyStats();

  const toggleFilterMode = async () => {
    await setFilterMode(filterMode === 'hide' ? 'blur' : 'hide');
  };

  const handleExport = async () => {
    try {
      const json = exportJSON();
      const fileName = `quietlounge_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'QuietLounge 차단 목록 내보내기',
      });
    } catch (e) {
      Alert.alert('오류', '내보내기에 실패했습니다.');
      console.error(e);
    }
  };

  const handleImport = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      const pickedFile = new File(asset.uri);
      const json = await pickedFile.text();

      await importJSON(json);
      Alert.alert('완료', '차단 목록을 가져왔습니다.');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '가져오기에 실패했습니다.';
      Alert.alert('오류', msg);
      console.error(e);
    }
  };

  const handleClearAll = () => {
    const total = allBlocked.byPersona.length + allBlocked.byNickname.length;
    if (total === 0) {
      Alert.alert('알림', '차단된 유저가 없습니다.');
      return;
    }
    Alert.alert(
      '전체 삭제',
      `${total}명의 차단을 모두 해제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '전체 삭제',
          style: 'destructive',
          onPress: clearAll,
        },
      ],
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* 내 활동 통계 */}
      <View style={styles.section}>
        <View style={styles.statsHeader}>
          <Text style={styles.sectionTitle}>내 활동 통계</Text>
          <TouchableOpacity onPress={refreshStats} style={styles.refreshBtn}>
            {statsLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <Text style={styles.refreshText}>↻</Text>
            )}
          </TouchableOpacity>
        </View>
        {myStats ? (
          <View style={styles.statsGrid}>
            <View style={[styles.statBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>{myStats.totalPosts}</Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>총 작성글</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {myStats.totalComments}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>총 댓글</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card }]}>
              {myStats.monthlyPosts === '...' ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ height: 24 }} />
              ) : (
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {myStats.monthlyPosts}
                </Text>
              )}
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>이번달 작성글</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {myStats.monthlyComments}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>이번달 댓글</Text>
            </View>
          </View>
        ) : (
          <Text style={[styles.statsHint, { color: colors.textSecondary }]}>
            {statsLoading ? '로딩 중...' : '라운지에 로그인하면 통계가 표시됩니다'}
          </Text>
        )}
      </View>

      {/* 필터 모드 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>필터 모드</Text>
        <View style={[styles.row, { backgroundColor: colors.card }]}>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>흐림 처리</Text>
            <Text style={[styles.rowDesc, { color: colors.textSecondary }]}>
              {filterMode === 'blur'
                ? '차단된 글을 흐리게 표시합니다'
                : '차단된 글을 완전히 숨깁니다'}
            </Text>
          </View>
          <Switch
            value={filterMode === 'blur'}
            onValueChange={toggleFilterMode}
            trackColor={{ false: colors.switchTrackOff, true: Colors.primary }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* 데이터 관리 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>데이터 관리</Text>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleExport}>
          <Text style={[styles.buttonText, { color: colors.text }]}>차단 목록 내보내기</Text>
          <Text style={[styles.buttonDesc, { color: colors.textSecondary }]}>JSON 파일로 백업</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleImport}>
          <Text style={[styles.buttonText, { color: colors.text }]}>차단 목록 가져오기</Text>
          <Text style={[styles.buttonDesc, { color: colors.textSecondary }]}>
            JSON 파일에서 복원
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.dangerBorder },
          ]}
          onPress={handleClearAll}>
          <Text style={[styles.buttonText, { color: Colors.danger }]}>전체 삭제</Text>
          <Text style={[styles.buttonDesc, { color: colors.textSecondary }]}>
            모든 차단 목록 초기화
          </Text>
        </TouchableOpacity>
      </View>

      {/* 정보 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>정보</Text>
        <View style={[styles.infoRow, { backgroundColor: colors.card }]}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>버전</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>1.0.0</Text>
        </View>
        <View style={[styles.infoRow, { backgroundColor: colors.card }]}>
          <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>차단 수</Text>
          <Text style={[styles.infoValue, { color: colors.text }]}>
            {allBlocked.byPersona.length + allBlocked.byNickname.length}명
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    color: '#1FAF63',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 16,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  button: {
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  buttonDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 10,
    padding: 16,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 14,
  },
  infoValue: {
    fontSize: 14,
  },
  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  refreshBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#555',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: {
    fontSize: 16,
    color: '#aaa',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statBox: {
    width: '48%' as unknown as number,
    flexGrow: 1,
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 4,
  },
  statsHint: {
    textAlign: 'center',
    fontSize: 13,
    paddingVertical: 16,
  },
});
