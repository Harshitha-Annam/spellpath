import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  DEV_LAN_HOST,
  ensureCustomApiBaseLoaded,
  getCustomApiBase,
  setCustomApiBase,
  testApiConnection,
} from '../api';

type Props = {
  disabled?: boolean;
};

export const ServerHostButton: React.FC<Props> = ({ disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<string | null>(null);

  useEffect(() => {
    void ensureCustomApiBaseLoaded().then((base) => {
      setActive(base);
      if (base) {
        setValue(base.replace(/^https?:\/\//i, ''));
      }
    });
  }, []);

  const openModal = () => {
    const current = getCustomApiBase();
    setActive(current);
    setValue(current ? current.replace(/^https?:\/\//i, '') : '');
    setError(null);
    setTestOk(null);
    setOpen(true);
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setTestOk(null);
    try {
      const ok = await testApiConnection(value);
      setTestOk(`Connected to ${ok}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await setCustomApiBase(value);
      setActive(next);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save server');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await setCustomApiBase(null);
      setActive(null);
      setValue('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        accessibilityLabel="Server address"
        activeOpacity={0.8}
        disabled={disabled}
        onPress={openModal}
        style={[styles.iconBtn, active ? styles.iconBtnActive : null, disabled && styles.disabled]}
      >
        <Text style={[styles.iconText, active ? styles.iconTextActive : null]}>⚙</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Server address</Text>
            <Text style={styles.hint}>
              Optional. Use when the default host is unreachable. Example:{' '}
              {DEV_LAN_HOST}
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder="192.168.x.x or host:8000"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
            {active ? (
              <Text style={styles.activeLabel}>Using {active}</Text>
            ) : (
              <Text style={styles.activeLabel}>Using built-in defaults</Text>
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {testOk ? <Text style={styles.success}>{testOk}</Text> : null}
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.secondaryBtn, (saving || testing) && styles.disabled]}
                disabled={saving || testing}
                onPress={() => void handleTest()}
              >
                <Text style={styles.secondaryBtnText}>
                  {testing ? 'Testing…' : 'Test'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, saving && styles.disabled]}
                disabled={saving || testing}
                onPress={() => void handleClear()}
              >
                <Text style={styles.secondaryBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, (saving || testing) && styles.disabled]}
                disabled={saving || testing}
                onPress={() => void handleSave()}
              >
                <Text style={styles.primaryBtnText}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => setOpen(false)} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  iconBtnActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#5eead4',
  },
  iconText: {
    fontSize: 18,
    color: '#475569',
    fontWeight: '700',
  },
  iconTextActive: {
    color: '#0f766e',
  },
  disabled: {
    opacity: 0.55,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  hint: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  activeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f766e',
  },
  error: {
    fontSize: 13,
    color: '#b91c1c',
    fontWeight: '600',
  },
  success: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#0f766e',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  secondaryBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14,
  },
  cancel: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  cancelText: {
    color: '#64748b',
    fontWeight: '600',
    fontSize: 14,
  },
});
