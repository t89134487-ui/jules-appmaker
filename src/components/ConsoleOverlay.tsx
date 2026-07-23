import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { logger, LogEntry } from '../services/logger';

export const ConsoleOverlay: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    // Subscribe to real-time log updates from our LoggerService
    const unsubscribe = logger.subscribe((newLogs) => {
      setLogs(newLogs);
    });
    return unsubscribe;
  }, []);

  const handleCopyLogs = async () => {
    if (logs.length === 0) {
      Alert.alert('Console', 'No logs to copy.');
      return;
    }
    const fullText = logs
      .map((log) => `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n');
    await Clipboard.setStringAsync(fullText);
    Alert.alert('Console', 'All logs copied to clipboard!');
  };

  const handleClearLogs = () => {
    logger.clear();
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error':
        return '#f87171';
      case 'warn':
        return '#fbbf24';
      default:
        return '#e4e4e7';
    }
  };

  return (
    <>
      {/* Small floating action button displayed on all screens */}
      <TouchableOpacity style={styles.fab} onPress={() => setVisible(true)}>
        <Text style={styles.fabText}>🪲 Logs</Text>
      </TouchableOpacity>

      {/* Modal Console log window */}
      <Modal
        visible={visible}
        animationType="slide"
        transparent
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.consoleContainer}>
            <View style={styles.header}>
              <Text style={styles.title}>🛠️ Debug Console Logs</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
                <Text style={styles.closeBtnText}>✕ Close</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              ref={flatListRef}
              data={logs}
              keyExtractor={(_, index) => index.toString()}
              contentContainerStyle={styles.logList}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <View style={styles.logRow}>
                  <Text style={styles.logTimestamp}>[{item.timestamp}]</Text>
                  <Text style={[styles.logText, { color: getLogColor(item.level) }]}>
                    [{item.level.toUpperCase()}] {item.message}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No logs recorded yet.</Text>
                </View>
              }
            />

            <View style={styles.footer}>
              <TouchableOpacity style={styles.clearBtn} onPress={handleClearLogs}>
                <Text style={styles.clearBtnText}>Clear logs</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.copyBtn} onPress={handleCopyLogs}>
                <Text style={styles.copyBtnText}>Copy All Logs</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 80,
    right: 20,
    backgroundColor: '#3b82f6',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 99999,
  },
  fabText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  consoleContainer: {
    backgroundColor: '#09090b',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: '80%',
    paddingBottom: 24,
    borderTopWidth: 2,
    borderColor: '#27272a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#27272a',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#27272a',
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  logList: {
    padding: 16,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  logTimestamp: {
    color: '#71717a',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginRight: 6,
    marginTop: 1,
  },
  logText: {
    flex: 1,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    color: '#71717a',
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#27272a',
  },
  clearBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#18181b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  clearBtnText: {
    color: '#ef4444',
    fontWeight: 'bold',
  },
  copyBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
  },
  copyBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
