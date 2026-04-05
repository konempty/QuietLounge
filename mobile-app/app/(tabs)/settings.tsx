import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Switch,
  ScrollView,
  ActivityIndicator,
  Linking,
  TextInput,
  Modal,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';

import { useBlockList } from '@/hooks/useBlockList';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useMyStats } from '@/hooks/useMyStats';
import { useKeywordAlerts } from '@/hooks/useKeywordAlerts';
import { requestNotificationPermission } from '@/utils/background-task';
import Colors from '@/constants/Colors';

export default function SettingsScreen() {
  const { exportJSON, importJSON, clearAll, allBlocked, filterMode, setFilterMode } = useBlockList();
  const { colors } = useThemeColors();
  const { stats: myStats, loading: statsLoading, attempted: statsAttempted, refresh: refreshStats } =
    useMyStats();
  const kwAlerts = useKeywordAlerts();
  const [showAddAlert, setShowAddAlert] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!myStats && !statsLoading && !statsAttempted) {
        refreshStats();
      }
    }, [myStats, statsLoading, statsAttempted, refreshStats]),
  );

  const toggleFilterMode = async () => {
    await setFilterMode(filterMode === 'hide' ? 'blur' : 'hide');
  };

  const handleExport = async () => {
    try {
      const parsed = JSON.parse(exportJSON());
      const kwData = kwAlerts.exportData();
      if (kwData) Object.assign(parsed, kwData);
      const json = JSON.stringify(parsed, null, 2);

      const fileName = `quietlounge_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.cache, fileName);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'QuietLounge 데이터 내보내기',
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

      const parsed = JSON.parse(json);
      if (parsed.keywordAlerts) {
        await kwAlerts.importData(parsed);

      }
      await importJSON(json);
      Alert.alert('완료', '데이터를 가져왔습니다.');
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
      {/* 차단 통계 */}
      <View style={styles.section}>
        <View style={styles.blockStatsRow}>
          <View style={[styles.blockStatBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.blockStatValue, { color: colors.text }]}>
              {allBlocked.byPersona.length + allBlocked.byNickname.length}
            </Text>
            <Text style={[styles.blockStatLabel, { color: colors.textSecondary }]}>총 차단 유저</Text>
          </View>
          <View style={[styles.blockStatBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.blockStatValue, { color: colors.text }]}>
              {allBlocked.byPersona.length}
            </Text>
            <Text style={[styles.blockStatLabel, { color: colors.textSecondary }]}>
              ID 확보된 유저
            </Text>
          </View>
          <View style={[styles.blockStatBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.blockStatValue, { color: colors.text }]}>
              {allBlocked.byNickname.length}
            </Text>
            <Text style={[styles.blockStatLabel, { color: colors.textSecondary }]}>
              닉네임만 확보
            </Text>
          </View>
        </View>
      </View>

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
              {myStats.monthlyComments === '...' ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ height: 24 }} />
              ) : (
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {myStats.monthlyComments}
                </Text>
              )}
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

      {/* 키워드 알림 */}
      <View style={styles.section}>
        <View style={styles.statsHeader}>
          <Text style={styles.sectionTitle}>키워드 알림</Text>
          <TouchableOpacity
            style={[styles.addAlertBtn, { backgroundColor: Colors.primary }]}
            onPress={() => setShowAddAlert(true)}>
            <Text style={styles.addAlertText}>+ 추가</Text>
          </TouchableOpacity>
        </View>

        {/* 확인 주기 */}
        <View style={[styles.row, { backgroundColor: colors.card, marginBottom: 8 }]}>
          <View style={styles.rowInfo}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>확인 주기</Text>
            {kwAlerts.interval < 3 && (
              <Text style={{ color: '#e6a23c', fontSize: 11, marginTop: 2 }}>
                주기가 짧으면 네트워크 사용량이 늘어날 수 있습니다
              </Text>
            )}
          </View>
          <View style={styles.intervalWrap}>
            <TouchableOpacity
              style={[styles.intervalBtn, { backgroundColor: colors.background }]}
              onPress={() => kwAlerts.setInterval(kwAlerts.interval - 1)}>
              <Text style={[styles.intervalBtnText, { color: colors.text }]}>-</Text>
            </TouchableOpacity>
            <Text style={[styles.intervalValue, { color: colors.text }]}>{kwAlerts.interval}분</Text>
            <TouchableOpacity
              style={[styles.intervalBtn, { backgroundColor: colors.background }]}
              onPress={() => kwAlerts.setInterval(kwAlerts.interval + 1)}>
              <Text style={[styles.intervalBtnText, { color: colors.text }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 알림 목록 */}
        {kwAlerts.alerts.length === 0 ? (
          <Text style={[styles.statsHint, { color: colors.textSecondary }]}>
            등록된 키워드 알림이 없습니다
          </Text>
        ) : (
          kwAlerts.alerts.map((alert) => (
            <View
              key={alert.id}
              style={[
                styles.alertItem,
                { backgroundColor: colors.card, opacity: alert.enabled ? 1 : 0.5 },
              ]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]}>{alert.channelName}</Text>
                <View style={styles.keywordTags}>
                  {alert.keywords.map((kw) => (
                    <Text key={kw} style={styles.keywordTag}>
                      {kw}
                    </Text>
                  ))}
                </View>
              </View>
              <Switch
                value={alert.enabled}
                onValueChange={(val) =>
                  kwAlerts.toggleAlert(alert.id, val)                }
                trackColor={{ false: colors.switchTrackOff, true: Colors.primary }}
                thumbColor="#fff"
              />
              <TouchableOpacity
                onPress={() => kwAlerts.removeAlert(alert.id)}
                style={{ marginLeft: 8, padding: 4 }}>
                <Text style={{ color: Colors.danger, fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
        <Text style={[styles.alertHint, { color: colors.textSecondary }]}>
          앱 사용 중에는 설정한 주기마다 키워드를 확인합니다. 앱을 닫았다가 다시 열면 그동안의 새
          글을 확인하여 알림을 한번에 보내드립니다.
        </Text>
      </View>

      {/* 키워드 알림 추가 모달 */}
      {showAddAlert && (
        <AddAlertModal
          colors={colors}
          onClose={() => setShowAddAlert(false)}
          onSave={async (channelId, channelName, keywords) => {
            const granted = await requestNotificationPermission();
            if (!granted) {
              Alert.alert('알림 권한 필요', '설정에서 알림 권한을 허용해 주세요.');
              return;
            }
            await kwAlerts.addAlert(channelId, channelName, keywords);
    
            setShowAddAlert(false);
          }}
        />
      )}

      {/* 데이터 관리 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>데이터 관리</Text>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleExport}>
          <Text style={[styles.buttonText, { color: colors.text }]}>데이터 내보내기</Text>
          <Text style={[styles.buttonDesc, { color: colors.textSecondary }]}>JSON 파일로 백업</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.card }]}
          onPress={handleImport}>
          <Text style={[styles.buttonText, { color: colors.text }]}>데이터 가져오기</Text>
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

      {/* 후원 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>후원</Text>
        <Text style={[styles.supportDesc, { color: colors.textSecondary }]}>
          QuietLounge는 무료이며, 개발·운영 비용은 모두 개발자가 부담하고 있습니다.
          응원하시고 싶으시다면 커피 한 잔으로 응원해 주세요!
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.supportButton]}
          onPress={() => Linking.openURL('https://qr.kakaopay.com/FG31jvTdV')}>
          <Text style={styles.supportText}>&#9749; 개발자에게 커피 한 잔 사주기</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.versionText}>v1.0.0</Text>
    </ScrollView>
  );
}

// ── 카테고리/채널 선택 → 키워드 입력 모달 ──
interface CategoryItem {
  categoryId: number;
  name: string;
}
interface ChannelItem {
  finalChannelId: string;
  name: string;
}

function AddAlertModal({
  colors,
  onClose,
  onSave,
}: {
  colors: ReturnType<typeof useThemeColors>['colors'];
  onClose: () => void;
  onSave: (channelId: string, channelName: string, keywords: string[]) => void;
}) {
  const [step, setStep] = useState<'category' | 'channel' | 'keywords'>('category');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChannelItem | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('https://api.lounge.naver.com/content-api/v1/categories?depth=2')
      .then((r) => r.json())
      .then((json) => setCategories(json.data?.items || []))
      .finally(() => setLoading(false));
  }, []);

  const loadChannels = async (categoryId: number) => {
    setLoading(true);
    setSearch('');
    const all: ChannelItem[] = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const resp = await fetch(
        `https://api.lounge.naver.com/content-api/v1/channels?categoryId=${categoryId}&page=${page}&size=50`,
      );
      const json = await resp.json();
      all.push(...(json.data?.items || []));
      const pageInfo = json.data?.page;
      if (!pageInfo || page * 50 >= pageInfo.totalElements) hasMore = false;
      else page++;
    }
    setChannels(all);
    setLoading(false);
    setStep('channel');
  };

  const addKeyword = () => {
    const kw = kwInput.trim();
    if (!kw || keywords.includes(kw)) {
      setKwInput('');
      return;
    }
    setKeywords([...keywords, kw]);
    setKwInput('');
  };

  const filtered =
    step === 'category'
      ? categories.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
      : channels.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={modalStyles.overlay}>
        <View style={[modalStyles.modal, { backgroundColor: colors.card }]}>
        <View style={modalStyles.header}>
          <Text style={[modalStyles.title, { color: colors.text }]}>
            {step === 'category' ? '카테고리 선택' : step === 'channel' ? '채널 선택' : '키워드 입력'}
          </Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: colors.textSecondary, fontSize: 20 }}>✕</Text>
          </TouchableOpacity>
        </View>

        {step !== 'keywords' && (
          <>
            {step === 'channel' && (
              <TouchableOpacity onPress={() => { setStep('category'); setSearch(''); }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
                  ← 카테고리 선택
                </Text>
              </TouchableOpacity>
            )}
            <TextInput
              style={[modalStyles.searchInput, { backgroundColor: colors.background, color: colors.text }]}
              placeholder="검색..."
              placeholderTextColor={colors.textSecondary}
              value={search}
              onChangeText={setSearch}
            />
            {loading ? (
              <ActivityIndicator style={{ padding: 20 }} color={Colors.primary} />
            ) : (
              <ScrollView style={{ maxHeight: 300 }}>
                {filtered.map((item: CategoryItem | ChannelItem) => (
                  <TouchableOpacity
                    key={'categoryId' in item ? item.categoryId : item.finalChannelId}
                    style={modalStyles.listItem}
                    onPress={() => {
                      if (step === 'category') {
                        loadChannels((item as CategoryItem).categoryId);
                      } else {
                        const ch = item as ChannelItem;
                        setSelectedChannel(ch);
                        setKeywords([]);
                        setStep('keywords');
                      }
                    }}>
                    <Text style={[{ color: colors.text, fontSize: 14 }]}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </>
        )}

        {step === 'keywords' && selectedChannel && (
          <>
            <TouchableOpacity onPress={() => setStep('channel')}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
                ← 채널 선택
              </Text>
            </TouchableOpacity>
            <Text style={{ color: Colors.primary, fontWeight: '600', fontSize: 15, marginBottom: 12 }}>
              {selectedChannel.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <TextInput
                style={[modalStyles.searchInput, { flex: 1, backgroundColor: colors.background, color: colors.text }]}
                placeholder="키워드 입력 후 Enter"
                placeholderTextColor={colors.textSecondary}
                value={kwInput}
                onChangeText={setKwInput}
                onSubmitEditing={addKeyword}
                returnKeyType="done"
              />
              <TouchableOpacity
                style={[modalStyles.kwAddBtn, { backgroundColor: colors.background }]}
                onPress={addKeyword}>
                <Text style={{ color: colors.text }}>추가</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.keywordTags}>
              {keywords.map((kw, i) => (
                <TouchableOpacity
                  key={kw}
                  onPress={() => setKeywords(keywords.filter((_, j) => j !== i))}>
                  <Text style={styles.keywordTag}>{kw} ✕</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[
                modalStyles.saveBtn,
                { backgroundColor: Colors.primary, opacity: keywords.length === 0 ? 0.4 : 1 },
              ]}
              disabled={keywords.length === 0}
              onPress={() => onSave(selectedChannel.finalChannelId, selectedChannel.name, keywords)}>
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>알림 등록</Text>
            </TouchableOpacity>
          </>
        )}
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  modal: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 14,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchInput: {
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  listItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  kwAddBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  saveBtn: {
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
});

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
  supportDesc: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
  },
  supportButton: {
    backgroundColor: '#6F4E37',
    alignItems: 'center',
  },
  supportText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  buttonDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  versionText: {
    textAlign: 'center',
    fontSize: 11,
    color: '#555',
    marginTop: 16,
    marginBottom: 24,
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
  blockStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  blockStatBox: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
  },
  blockStatValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  blockStatLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  addAlertBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  addAlertText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  intervalWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  intervalBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  intervalBtnText: {
    fontSize: 18,
    fontWeight: '600',
  },
  intervalValue: {
    fontSize: 14,
    fontWeight: '500',
    minWidth: 35,
    textAlign: 'center',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  keywordTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  alertHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  keywordTag: {
    backgroundColor: 'rgba(31,175,99,0.15)',
    color: '#1FAF63',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
