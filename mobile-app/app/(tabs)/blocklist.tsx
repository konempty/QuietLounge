import React from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useBlockList } from '@/hooks/useBlockList';
import { useThemeColors } from '@/hooks/useThemeColors';
import Colors from '@/constants/Colors';
import type { BlockedUser, NicknameOnlyBlock } from '../../shared/types';

type BlockItem =
  | { kind: 'persona'; data: BlockedUser }
  | { kind: 'nickname'; data: NicknameOnlyBlock };

export default function BlockListScreen() {
  const { allBlocked, unblockByPersonaId, unblockByNickname } = useBlockList();
  const { colors } = useThemeColors();

  const items: BlockItem[] = [
    ...allBlocked.byPersona
      .sort((a, b) => b.blockedAt.localeCompare(a.blockedAt))
      .map((d): BlockItem => ({ kind: 'persona', data: d })),
    ...allBlocked.byNickname
      .sort((a, b) => b.blockedAt.localeCompare(a.blockedAt))
      .map((d): BlockItem => ({ kind: 'nickname', data: d })),
  ];

  const handleUnblock = (item: BlockItem) => {
    const name = item.data.nickname;
    Alert.alert('차단 해제', `"${name}" 유저의 차단을 해제하시겠습니까?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '해제',
        onPress: () => {
          if (item.kind === 'persona') {
            unblockByPersonaId((item.data as BlockedUser).personaId);
          } else {
            unblockByNickname(item.data.nickname);
          }
        },
      },
    ]);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  const renderItem = ({ item }: { item: BlockItem }) => {
    const isPersona = item.kind === 'persona';
    const user = item.data;

    return (
      <View style={[styles.item, { borderBottomColor: colors.border }]}>
        <View style={styles.itemInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.nickname, { color: colors.text }]}>{user.nickname}</Text>
            {isPersona ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>ID</Text>
              </View>
            ) : (
              <View style={[styles.badge, styles.badgeNickname]}>
                <Text style={styles.badgeText}>닉네임</Text>
              </View>
            )}
          </View>
          {isPersona && (
            <Text style={[styles.personaId, { color: colors.textSecondary }]}>
              {(user as BlockedUser).personaId}
            </Text>
          )}
          {isPersona &&
            (user as BlockedUser).previousNicknames.length > 0 && (
              <Text style={[styles.prevNicknames, { color: colors.textSecondary }]}>
                이전: {(user as BlockedUser).previousNicknames.join(', ')}
              </Text>
            )}
          <Text style={[styles.date, { color: colors.textTertiary }]}>
            {formatDate(user.blockedAt)}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.unblockBtn, { borderColor: Colors.danger }]}
          onPress={() => handleUnblock(item)}>
          <Text style={[styles.unblockText, { color: Colors.danger }]}>해제</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerText, { color: colors.text }]}>
          총 {items.length}명 차단 중
        </Text>
        <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
          personaId {allBlocked.byPersona.length} / 닉네임 {allBlocked.byNickname.length}
        </Text>
      </View>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            차단된 유저가 없습니다
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, index) =>
            item.kind === 'persona'
              ? (item.data as BlockedUser).personaId
              : `nick-${index}`
          }
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
  },
  headerSub: {
    fontSize: 13,
    marginTop: 4,
  },
  list: {
    paddingBottom: 20,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  itemInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nickname: {
    fontSize: 15,
    fontWeight: '500',
  },
  badge: {
    backgroundColor: '#1FAF63',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeNickname: {
    backgroundColor: '#e67e22',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  personaId: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'SpaceMono',
  },
  prevNicknames: {
    fontSize: 12,
    marginTop: 2,
  },
  date: {
    fontSize: 11,
    marginTop: 4,
  },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  unblockText: {
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
  },
});
