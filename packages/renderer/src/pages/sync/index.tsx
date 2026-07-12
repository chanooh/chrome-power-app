import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CrownOutlined,
  DesktopOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RetweetOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StopOutlined,
  SyncOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import type {ColumnsType} from 'antd/es/table';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {SyncBridge, WindowBridge} from '#preload';
import type {DB} from '../../../../shared/types/db';
import type {
  SyncCapabilities,
  SyncOptions,
  SyncPermissionStatus,
  SyncSessionStatus,
  SyncTargetState,
} from '../../../../shared/types/sync';
import type {MonitorInfo} from '../../../../preload/src/bridges/sync';

const {Text, Title} = Typography;

const defaultOptions: SyncOptions = {
  engine: 'hybrid',
  enableMouseSync: true,
  enableKeyboardSync: true,
  enableWheelSync: true,
  enableTextSync: true,
  enableClipboardSync: true,
  enableTabSync: true,
  enableExtensionSync: true,
  allowSensitiveInput: true,
  autoArrange: true,
  monitorIndex: 0,
  columns: 3,
  spacing: 10,
  height: 0,
  mouseMoveThrottleMs: 33,
  wheelThrottleMs: 33,
  failurePolicy: 'isolate',
};

const emptyPermissions: SyncPermissionStatus = {
  supported: false,
  accessibility: false,
  listenEvents: false,
  postEvents: false,
  ready: false,
};

const emptyStatus: SyncSessionStatus = {
  active: false,
  permissions: emptyPermissions,
  targets: [],
  metrics: {
    eventsCaptured: 0,
    eventsDispatched: 0,
    eventsCoalesced: 0,
    eventsFailed: 0,
    averageLatencyMs: 0,
    p95LatencyMs: 0,
  },
};

const targetColor = (status?: SyncTargetState['status']) => {
  if (status === 'syncing') return 'processing';
  if (status === 'degraded') return 'warning';
  if (status === 'disconnected') return 'error';
  return 'default';
};

const SyncPage = () => {
  const {t} = useTranslation();
  const [windows, setWindows] = useState<DB.Window[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [masterWindowId, setMasterWindowId] = useState<number>();
  const [options, setOptions] = useState<SyncOptions>(() => {
    try {
      return {...defaultOptions, ...JSON.parse(localStorage.getItem('macSyncOptions') || '{}')};
    } catch {
      return defaultOptions;
    }
  });
  const [capabilities, setCapabilities] = useState<SyncCapabilities>();
  const [permissions, setPermissions] = useState<SyncPermissionStatus>(emptyPermissions);
  const [status, setStatus] = useState<SyncSessionStatus>(emptyStatus);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval>>();

  const refresh = useCallback(async () => {
    const [opened, nextCapabilities, nextPermissions, nextStatus, monitorResult] =
      await Promise.all([
        WindowBridge.getOpenedWindows(),
        SyncBridge.getCapabilities(),
        SyncBridge.getPermissionStatus(),
        SyncBridge.getSyncStatus(),
        SyncBridge.getMonitors(),
      ]);
    const openedWindows = opened as DB.Window[];
    setWindows(openedWindows);
    setCapabilities(nextCapabilities);
    setPermissions(nextPermissions);
    setStatus(nextStatus);
    if (monitorResult.success) setMonitors(monitorResult.monitors);
    setMasterWindowId(current => current || openedWindows[0]?.id);
    setSelectedIds(current => {
      const valid = current.filter(id => openedWindows.some(window => window.id === id));
      return valid.length > 0 ? valid : openedWindows.map(window => window.id!);
    });
  }, []);

  useEffect(() => {
    void refresh();
    const removeStatus = SyncBridge.onStatusUpdated(setStatus);
    const removeTarget = SyncBridge.onTargetUpdated(target => {
      setStatus(current => ({
        ...current,
        targets: current.targets.map(candidate =>
          candidate.windowId === target.windowId ? target : candidate,
        ),
      }));
    });
    return () => {
      removeStatus();
      removeTarget();
    };
  }, [refresh]);

  useEffect(() => {
    localStorage.setItem('macSyncOptions', JSON.stringify(options));
  }, [options]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = undefined;
    if (status.active) {
      pollingRef.current = setInterval(() => {
        void SyncBridge.getSyncStatus().then(setStatus);
      }, 1_000);
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [status.active]);

  const handleStart = useCallback(async () => {
    if (!masterWindowId) {
      message.warning(t('sync_msg_set_master_first'));
      return;
    }
    const slaveWindowIds = selectedIds.filter(id => id !== masterWindowId);
    if (!selectedIds.includes(masterWindowId)) {
      message.warning(t('sync_msg_master_selected'));
      return;
    }
    if (slaveWindowIds.length === 0) {
      message.warning(t('sync_msg_select_slave'));
      return;
    }
    const result = await SyncBridge.startSync({masterWindowId, slaveWindowIds, options});
    if (!result.success) {
      message.error(t('sync_msg_start_failed', {error: result.error}));
      return;
    }
    if (result.status) setStatus(result.status);
    message.success(t('sync_msg_started', {count: slaveWindowIds.length}));
  }, [masterWindowId, options, selectedIds, t]);

  const handleStop = useCallback(async () => {
    const result = await SyncBridge.stopSync();
    if (result.status) setStatus(result.status);
    message.success(t('sync_msg_stopped'));
  }, [t]);

  useEffect(() => {
    const removeStart = SyncBridge.onShortcutStart(() => {
      if (!status.active) void handleStart();
    });
    const removeStop = SyncBridge.onShortcutStop(() => {
      if (status.active) void handleStop();
    });
    return () => {
      removeStart();
      removeStop();
    };
  }, [handleStart, handleStop, status.active]);

  const handlePermissions = async () => {
    setPermissions(await SyncBridge.requestPermissions());
  };

  const handleArrange = async () => {
    const selected = windows.filter(window => selectedIds.includes(window.id!));
    if (selected.length === 0 || !masterWindowId) {
      message.warning(t('sync_msg_select_windows'));
      return;
    }
    const master = selected.find(window => window.id === masterWindowId);
    if (!master?.pid) return;
    const result = await SyncBridge.arrangeWindows({
      mainPid: master.pid,
      childPids: selected.filter(window => window.id !== masterWindowId).map(window => window.pid!),
      columns: options.columns,
      spacing: options.spacing,
      size: {width: 0, height: options.height},
      monitorIndex: options.monitorIndex,
    });
    if (result.success) message.success(t('sync_msg_arranged'));
    else message.error(result.error);
  };

  const updateOption = <K extends keyof SyncOptions>(key: K, value: SyncOptions[K]) =>
    setOptions(current => ({...current, [key]: value}));

  const targetByWindow = useMemo(
    () => new Map(status.targets.map(target => [target.windowId, target])),
    [status.targets],
  );

  const columns: ColumnsType<DB.Window> = [
    {title: 'ID', dataIndex: 'id', width: 58},
    {title: t('window_column_name'), dataIndex: 'name', ellipsis: true},
    {title: t('window_column_profile_id'), dataIndex: 'profile_id', width: 110, ellipsis: true},
    {
      title: t('sync_control'),
      width: 105,
      render: (_, record) =>
        record.id === masterWindowId ? (
          <Tag
            color="blue"
            icon={<CrownOutlined />}
          >
            {t('sync_status_master')}
          </Tag>
        ) : (
          <Tag>{t('sync_status_ready')}</Tag>
        ),
    },
    {
      title: 'Status',
      width: 118,
      render: (_, record) => {
        if (record.id === masterWindowId && status.active) {
          return <Tag color="blue">Master</Tag>;
        }
        const target = targetByWindow.get(record.id!);
        return <Tag color={targetColor(target?.status)}>{target?.status || 'ready'}</Tag>;
      },
    },
    {
      title: 'Latency',
      width: 92,
      render: (_, record) => {
        const target = targetByWindow.get(record.id!);
        return target ? `${target.latencyMs} ms` : '-';
      },
    },
    {
      title: t('window_column_action'),
      width: 90,
      render: (_, record) => {
        const target = targetByWindow.get(record.id!);
        return (
          <Space size={4}>
            <Tooltip title={t('sync_action_set_master')}>
              <Button
                type={record.id === masterWindowId ? 'primary' : 'text'}
                icon={<CrownOutlined />}
                disabled={status.active || record.id === masterWindowId}
                onClick={() => setMasterWindowId(record.id)}
              />
            </Tooltip>
            {(target?.status === 'degraded' || target?.status === 'disconnected') && (
              <Tooltip title="Retry">
                <Button
                  type="text"
                  icon={<RetweetOutlined />}
                  onClick={() =>
                    void SyncBridge.retryTarget(record.id!).then(
                      result => result.status && setStatus(result.status),
                    )
                  }
                />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  const permissionAlert = !permissions.ready && capabilities?.supported;
  const canStart =
    !!masterWindowId &&
    permissions.ready &&
    selectedIds.includes(masterWindowId) &&
    selectedIds.some(id => id !== masterWindowId) &&
    selectedIds.length <= (capabilities?.maxProfiles || 30);

  return (
    <>
      <div className="content-toolbar">
        <Space>
          {!status.active ? (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!canStart}
              onClick={handleStart}
            >
              {t('sync_start')}
            </Button>
          ) : (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={handleStop}
            >
              {t('sync_stop')}
            </Button>
          )}
          <Button
            icon={<WindowsOutlined />}
            disabled={status.active}
            onClick={handleArrange}
          >
            {t('sync_arrange_button')}
          </Button>
          {status.active && (
            <Tag
              color="processing"
              icon={<SyncOutlined spin />}
            >
              {status.targets.filter(target => target.status === 'syncing').length} syncing
            </Tag>
          )}
        </Space>
        <Space className="content-toolbar-btns">
          <Text type="secondary">
            P95 {status.metrics.p95LatencyMs} ms · {status.metrics.eventsDispatched} events
          </Text>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
          />
        </Space>
      </div>

      {capabilities && !capabilities.supported && (
        <Alert
          type="error"
          showIcon
          message="macOS arm64 native synchronization is unavailable."
        />
      )}
      {permissionAlert && (
        <Alert
          type="warning"
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="Accessibility and Input Monitoring permissions are required."
          action={
            <Space>
              <Button
                size="small"
                onClick={() => void handlePermissions()}
              >
                Request
              </Button>
              <Button
                size="small"
                onClick={() => void SyncBridge.openPermissionSettings('accessibility')}
              >
                Accessibility
              </Button>
              <Button
                size="small"
                onClick={() => void SyncBridge.openPermissionSettings('inputMonitoring')}
              >
                Input Monitoring
              </Button>
            </Space>
          }
        />
      )}

      <Row
        gutter={12}
        style={{marginTop: 12}}
      >
        <Col span={17}>
          <Card bordered={false}>
            <Title
              level={5}
              style={{marginTop: 0}}
            >
              <DesktopOutlined /> {t('sync_opened_windows')}
            </Title>
            <Table
              className="content-table"
              dataSource={windows}
              rowKey="id"
              columns={columns}
              pagination={false}
              scroll={{y: Math.max(320, window.innerHeight - 300)}}
              rowSelection={{
                selectedRowKeys: selectedIds,
                onChange: keys => setSelectedIds(keys.map(Number)),
                getCheckboxProps: () => ({disabled: status.active}),
              }}
            />
          </Card>
        </Col>

        <Col span={7}>
          <Card
            bordered={false}
            title={
              <Space>
                <SettingOutlined />
                {t('sync_control_panel')}
              </Space>
            }
          >
            <Form
              layout="vertical"
              size="small"
            >
              <Form.Item label="Engine">
                <Select
                  value={options.engine}
                  disabled={status.active}
                  onChange={value => updateOption('engine', value)}
                  options={[
                    {label: 'Hybrid CDP + Native', value: 'hybrid'},
                    {label: 'Native only', value: 'native'},
                  ]}
                />
              </Form.Item>
              <Form.Item label={t('sync_display')}>
                <Select
                  value={options.monitorIndex}
                  disabled={status.active || monitors.length === 0}
                  onChange={value => updateOption('monitorIndex', value)}
                  options={monitors.map(monitor => ({
                    label: `${monitor.isPrimary ? 'Primary' : 'Display'} ${monitor.width}x${monitor.height}`,
                    value: monitor.index,
                  }))}
                />
              </Form.Item>
              <Row gutter={8}>
                <Col span={8}>
                  <Form.Item label={t('arrange_columns')}>
                    <InputNumber
                      min={1}
                      max={12}
                      value={options.columns}
                      disabled={status.active}
                      onChange={value => updateOption('columns', value || 1)}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('arrange_spacing')}>
                    <InputNumber
                      min={0}
                      max={50}
                      value={options.spacing}
                      disabled={status.active}
                      onChange={value => updateOption('spacing', value || 0)}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label={t('arrange_height')}>
                    <InputNumber
                      min={0}
                      value={options.height}
                      disabled={status.active}
                      onChange={value => updateOption('height', value || 0)}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Divider style={{margin: '4px 0 12px'}} />
              <Space
                direction="vertical"
                style={{width: '100%'}}
              >
                <SwitchRow
                  label={t('sync_mouse')}
                  value={options.enableMouseSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableMouseSync', value)}
                />
                <SwitchRow
                  label={t('sync_keyboard')}
                  value={options.enableKeyboardSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableKeyboardSync', value)}
                />
                <SwitchRow
                  label={t('sync_wheel')}
                  value={options.enableWheelSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableWheelSync', value)}
                />
                <SwitchRow
                  label="Unicode / IME"
                  value={options.enableTextSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableTextSync', value)}
                />
                <SwitchRow
                  label="Clipboard"
                  value={options.enableClipboardSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableClipboardSync', value)}
                />
                <SwitchRow
                  label="Tabs"
                  value={options.enableTabSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableTabSync', value)}
                />
                <SwitchRow
                  label="Extension pages"
                  value={options.enableExtensionSync}
                  disabled={status.active}
                  onChange={value => updateOption('enableExtensionSync', value)}
                />
                <SwitchRow
                  label="Auto arrange"
                  value={options.autoArrange}
                  disabled={status.active}
                  onChange={value => updateOption('autoArrange', value)}
                />
              </Space>
              <Divider style={{margin: '12px 0'}} />
              <Tag color="warning">Sensitive input enabled</Tag>
            </Form>
          </Card>
        </Col>
      </Row>
    </>
  );
};

const SwitchRow = ({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) => (
  <div
    style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28}}
  >
    <Text>{label}</Text>
    <Switch
      size="small"
      checked={value}
      disabled={disabled}
      onChange={onChange}
    />
  </div>
);

export default SyncPage;
