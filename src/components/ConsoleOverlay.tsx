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

interface ConsoleOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export const ConsoleOverlay: React.FC<ConsoleOverlayProps> = ({ visible, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
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
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.consoleContainer}>
          <View style={styles.header}>
            <Text style={styles.title}>🛠️ Debug Console Logs</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>✕ Close</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={logs}
            keyExtractor={(_, index) => index.toString()}
            contentContainerStyle={styles.logList}
            renderItem={({ item, index }) => {
              const isExpanded = expandedIndex === index;
              const hasPayload = !!item.fullPayload;

              let formattedPayload = '';
              if (isExpanded && hasPayload && item.fullPayload) {
                try {
                  formattedPayload = JSON.stringify(JSON.parse(item.fullPayload), null, 2);
                } catch {
                  formattedPayload = item.fullPayload;
                }
              }

              return (
                <View style={styles.logRowContainer}>
                  <TouchableOpacity
                    style={styles.logRow}
                    disabled={!hasPayload}
                    onPress={() => setExpandedIndex(isExpanded ? null : index)}
                  >
                    <Text style={styles.logTimestamp}>[{item.timestamp}]</Text>
                    <Text style={[styles.logText, { color: getLogColor(item.level) }]}>
                      [{item.level.toUpperCase()}] {item.message} {hasPayload ? (isExpanded ? '▼' : '▶ (tap to expand payload)') : ''}
                    </Text>
                  </TouchableOpacity>
                  {isExpanded && hasPayload && (
                    <View style={styles.payloadBox}>
                      <Text selectable style={styles.payloadText}>{formattedPayload}</Text>
                    </View>
                  )}
                </View>
              );
            }}
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
  );
};

const styles = StyleSheet.create({
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
  logRowContainer: {
    borderBottomWidth: 1,
    borderColor: '#18181b',
    paddingVertical: 4,
  },
  payloadBox: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 6,
    padding: 8,
    marginTop: 6,
    marginLeft: 20,
  },
  payloadText: {
    color: '#a1a1aa',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    lineHeight: 15,
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
