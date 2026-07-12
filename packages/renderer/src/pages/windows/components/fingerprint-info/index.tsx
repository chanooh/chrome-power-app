import './index.css';
import {Button, Modal, Space, Tag, Tooltip, Typography, message} from 'antd';
import {ExperimentOutlined, ReloadOutlined} from '@ant-design/icons';
import {useMemo, useState} from 'react';
import type {
  FingerprintDiagnosticResult,
  FingerprintSnapshot,
} from '../../../../../../shared/types/fingerprint';
import type {SafeAny} from '../../../../../../shared/types/db';
import {WindowBridge} from '#preload';

const {Text} = Typography;

const statusColor = {
  pass: 'success',
  warning: 'warning',
  fail: 'error',
} as const;

const formatList = (value?: unknown[]) => (value?.length ? value.join(', ') : 'Pending');

const FingerprintInfo = ({
  fingerprints,
  windowId,
  running = false,
  onFingerprintRegenerated,
}: {
  fingerprints: SafeAny;
  windowId?: number;
  running?: boolean;
  onFingerprintRegenerated?: (snapshot: FingerprintSnapshot) => void;
}) => {
  const [diagnostics, setDiagnostics] = useState<FingerprintDiagnosticResult | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [regenerationLoading, setRegenerationLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage({
    duration: 3,
    top: 100,
  });

  const snapshot = fingerprints as Partial<FingerprintSnapshot>;
  const rows = useMemo(
    () => [
      {
        title: 'Template',
        value: snapshot.templateId
          ? `${snapshot.requestedTemplateId || 'auto'} -> ${snapshot.templateId}`
          : 'Pending',
      },
      {
        title: 'User-Agent',
        value: snapshot.ua || 'Pending',
      },
      {
        title: 'UA-CH',
        value: snapshot.uaCh
          ? `${snapshot.uaCh.platform} ${snapshot.uaCh.platformVersion} / ${snapshot.uaCh.architecture}${snapshot.uaCh.bitness}`
          : 'Pending',
      },
      {
        title: 'Timezone',
        value: snapshot.timezone || 'Pending',
      },
      {
        title: 'Language',
        value: snapshot.languages ? formatList(snapshot.languages) : 'Pending',
      },
      {
        title: 'Screen',
        value: snapshot.screen
          ? `${snapshot.screen.width}x${snapshot.screen.height} @${snapshot.screen.deviceScaleFactor}`
          : 'Pending',
      },
      {
        title: 'Hardware',
        value: snapshot.navigator
          ? `${snapshot.navigator.hardwareConcurrency} cores / ${snapshot.navigator.deviceMemory} GB`
          : 'Pending',
      },
      {
        title: 'Fonts',
        value: snapshot.fonts ? `${snapshot.fonts.length} macOS fonts` : 'Pending',
      },
      {
        title: 'WebGL',
        value: snapshot.webgl?.unmaskedRenderer || 'Pending',
      },
      {
        title: 'WebGPU',
        value: snapshot.webgpu?.mode || 'Pending',
      },
      {
        title: 'Canvas',
        value: snapshot.canvas?.seed || 'Pending',
      },
      {
        title: 'Audio',
        value: snapshot.audio?.seed || 'Pending',
      },
      {
        title: 'Media Devices',
        value: snapshot.mediaDevices
          ? snapshot.mediaDevices.map(device => `${device.kind}:${device.label}`).join(', ')
          : 'Pending',
      },
    ],
    [fingerprints],
  );

  const runDiagnostics = async () => {
    if (!windowId) {
      return;
    }
    setDiagnosticLoading(true);
    try {
      const result = await WindowBridge.getFingerprintDiagnostics(windowId);
      setDiagnostics(result);
    } catch (error) {
      messageApi.error((error as Error).message || 'Fingerprint diagnostics failed');
    } finally {
      setDiagnosticLoading(false);
    }
  };

  const confirmRegeneration = () => {
    if (!windowId) {
      return;
    }
    Modal.confirm({
      title: 'Regenerate fingerprint?',
      content:
        'A new Auto fingerprint will be used on the next launch. Profile data, cookies and extensions are unchanged.',
      okText: 'Regenerate',
      cancelText: 'Cancel',
      onOk: async () => {
        setRegenerationLoading(true);
        try {
          const result = await WindowBridge.regenerateFingerprint(windowId);
          if (!result.success || !result.data) {
            messageApi.error(result.message);
            return;
          }
          setDiagnostics(null);
          onFingerprintRegenerated?.(result.data);
          messageApi.success(result.message);
        } catch (error) {
          messageApi.error((error as Error).message || 'Fingerprint regeneration failed');
        } finally {
          setRegenerationLoading(false);
        }
      },
    });
  };

  return (
    <div className="fingerprint-wrapper">
      {contextHolder}
      <div className="fingerprint-header">
        <Text strong>Fingerprint</Text>
        {windowId && (
          <Space size={6}>
            <Tooltip
              title={
                running
                  ? 'Close the profile before regenerating'
                  : 'Generate a new Auto fingerprint'
              }
            >
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={regenerationLoading}
                disabled={running}
                onClick={confirmRegeneration}
              >
                Regenerate
              </Button>
            </Tooltip>
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              loading={diagnosticLoading}
              onClick={runDiagnostics}
            >
              Diagnose
            </Button>
          </Space>
        )}
      </div>
      {diagnostics && (
        <div className="fingerprint-diagnostics">
          <Space size={8}>
            <Text strong>Diagnostics</Text>
            <Tag color={statusColor[diagnostics.overallStatus]}>
              {diagnostics.overallStatus.toUpperCase()}
            </Tag>
          </Space>
          {diagnostics.items.map(item => (
            <div
              className="fingerprint-diagnostic-row"
              key={item.key}
            >
              <Tag color={statusColor[item.status]}>{item.status}</Tag>
              <Text className="fingerprint-diagnostic-label">{item.label}</Text>
            </div>
          ))}
        </div>
      )}
      {rows.map((item, index) => (
        <div
          className={`flex ${index > 0 && 'mt-2'}`}
          key={item.title}
        >
          <div className="fingerprint-title text-gray-500">{item.title}</div>
          <div className="fingerprint-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
};

export default FingerprintInfo;
