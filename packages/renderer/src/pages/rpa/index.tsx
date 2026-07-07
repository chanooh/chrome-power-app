import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import {useEffect, useMemo, useState} from 'react';
import {RpaBridge, WindowBridge} from '#preload';
import type {DB, SafeAny} from '../../../../shared/types/db';
import type {
  RpaRecorderEvent,
  RpaRecorderSession,
  RpaRun,
  RpaSessionMode,
  RpaTask,
  RpaTaskFlow,
  RpaTaskStep,
} from '../../../../shared/types/rpa';

const {Text} = Typography;
const CheckboxGroup = Checkbox.Group;

const sampleFlow: RpaTaskFlow = {
  schemaVersion: 1,
  steps: [
    {
      id: 'open-example',
      type: 'goto',
      url: 'https://example.com',
      timeoutMs: 30000,
    },
    {
      id: 'assert-example',
      type: 'assertText',
      expected: 'Example Domain',
      timeoutMs: 10000,
    },
    {
      id: 'capture-example',
      type: 'screenshot',
    },
  ],
};

const statusColor = (status?: string) => {
  if (status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'canceled' || status === 'interrupted') return 'error';
  if (status === 'running') return 'processing';
  if (status === 'paused' || status === 'stopping') return 'warning';
  return 'default';
};

const parseFlowJson = (flowJson: string): RpaTaskFlow => JSON.parse(flowJson);

const formatFlowJson = (flow?: RpaTaskFlow) => JSON.stringify(flow || sampleFlow, null, 2);

const sessionModeOptions: Array<{label: string; value: RpaSessionMode}> = [
  {label: 'Task URL only', value: 'taskUrlOnly'},
  {label: 'Clean pages', value: 'cleanPages'},
  {label: 'Keep existing', value: 'keepExisting'},
];

const Rpa = () => {
  const [messageApi, contextHolder] = message.useMessage({duration: 2, top: 120});
  const [tasks, setTasks] = useState<RpaTask[]>([]);
  const [runs, setRuns] = useState<RpaRun[]>([]);
  const [windows, setWindows] = useState<DB.Window[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [runDrawerOpen, setRunDrawerOpen] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<RpaTask>();
  const [activeRun, setActiveRun] = useState<RpaRun>();
  const [selectedWindows, setSelectedWindows] = useState<number[]>([]);
  const [recorderWindowId, setRecorderWindowId] = useState<number>();
  const [recorderSession, setRecorderSession] = useState<RpaRecorderSession>();
  const [recorderEvents, setRecorderEvents] = useState<RpaRecorderEvent[]>([]);
  const [recorderSessionMode, setRecorderSessionMode] = useState<RpaSessionMode>('cleanPages');
  const [form] = Form.useForm();

  const windowOptions = useMemo(
    () =>
      windows.map(window => ({
        label: `${window.name || window.profile_id || window.id} (#${window.id})`,
        value: window.id!,
      })),
    [windows],
  );

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [taskRows, runRows, windowRows] = await Promise.all([
        RpaBridge.listTasks(),
        RpaBridge.listRuns(),
        WindowBridge.getAll(),
      ]);
      setTasks(taskRows || []);
      setRuns((runRows || []).filter(Boolean));
      setWindows(windowRows || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const offRun = RpaBridge.onRunUpdated((_, run) => {
      setActiveRun(current => (current?.id === run?.id ? run : current));
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
    });
    const offStep = RpaBridge.onStepUpdated((_, run) => {
      setActiveRun(current => (current?.id === run?.id ? run : current));
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
    });
    const offRecorder = RpaBridge.onRecorderEvent((_, event) => {
      setRecorderEvents(current => [...current, event]);
    });
    return () => {
      offRun();
      offStep();
      offRecorder();
    };
  }, []);

  const openCreate = () => {
    setEditingTask(undefined);
    setSelectedWindows([]);
    form.setFieldsValue({
      name: 'New RPA Task',
      description: '',
      defaultConcurrency: 1,
      defaultTimeoutMs: 30000,
      defaultRetry: 0,
      screenshotPolicy: 'on-failure',
      closePolicy: 'keepOpen',
      sessionMode: 'taskUrlOnly',
      variablesJson: '{}',
      flowJson: formatFlowJson(sampleFlow),
    });
    setEditorOpen(true);
  };

  const openEdit = (task: RpaTask) => {
    setEditingTask(task);
    setSelectedWindows((task.profileBindings || []).map(binding => binding.window_id));
    form.setFieldsValue({
      name: task.name,
      description: task.description,
      defaultConcurrency: task.defaultConcurrency,
      defaultTimeoutMs: task.defaultTimeoutMs,
      defaultRetry: task.defaultRetry,
      screenshotPolicy: task.screenshotPolicy,
      closePolicy: task.closePolicy,
      sessionMode: task.sessionMode || 'taskUrlOnly',
      variablesJson: JSON.stringify(task.variables || {}, null, 2),
      flowJson: formatFlowJson(task.flow),
    });
    setEditorOpen(true);
  };

  const saveTask = async () => {
    const values = await form.validateFields();
    let flow: RpaTaskFlow;
    let variables: Record<string, string>;
    try {
      flow = parseFlowJson(values.flowJson);
      variables = JSON.parse(values.variablesJson || '{}');
    } catch (error) {
      messageApi.error((error as Error).message);
      return;
    }
    const task: RpaTask = {
      id: editingTask?.id,
      name: values.name,
      description: values.description,
      flow,
      defaultConcurrency: values.defaultConcurrency,
      defaultTimeoutMs: values.defaultTimeoutMs,
      defaultRetry: values.defaultRetry,
      screenshotPolicy: values.screenshotPolicy,
      closePolicy: values.closePolicy,
      sessionMode: values.sessionMode,
      variables,
      profileBindings: selectedWindows.map(windowId => ({window_id: windowId})),
    };
    const validation = await RpaBridge.validateTask(task);
    if (!validation.valid) {
      messageApi.error(validation.issues.map(issue => issue.message).join('; '));
      return;
    }
    if (editingTask?.id) {
      await RpaBridge.updateTask(editingTask.id, task);
      messageApi.success('RPA task updated');
    } else {
      await RpaBridge.createTask(task);
      messageApi.success('RPA task created');
    }
    setEditorOpen(false);
    await fetchAll();
  };

  const startRun = async (task: RpaTask) => {
    const run = await RpaBridge.startRun(task.id!, {
      concurrency: task.defaultConcurrency,
      closePolicy: task.closePolicy,
      sessionMode: task.sessionMode || 'taskUrlOnly',
    });
    setActiveRun(run);
    setRunDrawerOpen(true);
    await fetchAll();
  };

  const refreshActiveRun = async () => {
    if (!activeRun?.id) return;
    setActiveRun(await RpaBridge.getRun(activeRun.id));
    await fetchAll();
  };

  const startRecorder = async () => {
    if (!recorderWindowId) {
      messageApi.warning('Select a profile first');
      return;
    }
    const session = await RpaBridge.startRecorder(recorderWindowId, {
      sessionMode: recorderSessionMode,
    });
    setRecorderSession(session);
    setRecorderEvents(session.events || []);
    messageApi.success('Recorder started');
  };

  const stopRecorder = async () => {
    if (!recorderSession) return;
    const session = await RpaBridge.stopRecorder(recorderSession.sessionId);
    setRecorderSession(undefined);
    setRecorderEvents(session.events || recorderEvents);
    messageApi.success('Recorder stopped');
  };

  const appendRecorderSteps = () => {
    const steps = recorderEvents.map(event => event.step).filter(Boolean) as RpaTaskStep[];
    if (!steps.length) {
      messageApi.warning('No recorder steps to append');
      return;
    }
    const current = parseFlowJson(form.getFieldValue('flowJson') || formatFlowJson(sampleFlow));
    form.setFieldValue(
      'flowJson',
      formatFlowJson({
        schemaVersion: 1,
        steps: [...current.steps, ...steps],
      }),
    );
    setRecorderEvents([]);
    setRecorderSession(undefined);
    setRecorderOpen(false);
    messageApi.success(`${steps.length} steps appended`);
  };

  const clearRecorderEvents = () => {
    if (recorderSession) {
      messageApi.warning('Stop the recorder before clearing events');
      return;
    }
    setRecorderEvents([]);
    messageApi.success('Recorder events cleared');
  };

  const taskColumns = [
    {
      title: 'Task',
      dataIndex: 'name',
      render: (_: string, task: RpaTask) => (
        <Space direction="vertical" size={2}>
          <Text strong>{task.name}</Text>
          <Text type="secondary">{task.description || `${task.flow.steps.length} steps`}</Text>
        </Space>
      ),
    },
    {
      title: 'Profiles',
      width: 100,
      render: (_: SafeAny, task: RpaTask) => task.profileBindings?.length || 0,
    },
    {
      title: 'Concurrency',
      dataIndex: 'defaultConcurrency',
      width: 110,
    },
    {
      title: 'Screenshots',
      dataIndex: 'screenshotPolicy',
      width: 130,
    },
    {
      title: 'Action',
      width: 260,
      render: (_: SafeAny, task: RpaTask) => (
        <Space>
          <Button icon={<PlayCircleOutlined />} type="primary" onClick={() => startRun(task)}>
            Run
          </Button>
          <Button icon={<EditOutlined />} onClick={() => openEdit(task)}>
            Edit
          </Button>
          <Popconfirm
            title="Delete RPA task?"
            onConfirm={async () => {
              await RpaBridge.deleteTask(task.id!);
              await fetchAll();
            }}
          >
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const runColumns = [
    {
      title: 'Run',
      dataIndex: 'id',
      width: 80,
      render: (id: number) => `#${id}`,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      render: (status: string) => <Tag color={statusColor(status)}>{status}</Tag>,
    },
    {
      title: 'Profiles',
      width: 130,
      render: (_: SafeAny, run: RpaRun) =>
        `${run.succeeded_profiles || 0}/${run.total_profiles || 0} ok`,
    },
    {
      title: 'Message',
      dataIndex: 'message',
    },
    {
      title: 'Action',
      width: 100,
      render: (_: SafeAny, run: RpaRun) => (
        <Button
          size="small"
          onClick={() => {
            setActiveRun(run);
            setRunDrawerOpen(true);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  const runStepColumns = [
    {title: 'Profile', dataIndex: 'window_id', width: 80},
    {title: 'Step', dataIndex: 'step_id', width: 160},
    {title: 'Type', dataIndex: 'step_type', width: 120},
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (status: string) => <Tag color={statusColor(status)}>{status}</Tag>,
    },
    {title: 'Message', dataIndex: 'message'},
    {
      title: 'Artifact',
      dataIndex: 'artifact_path',
      render: (path?: string) => path ? <Text code copyable>{path}</Text> : null,
    },
  ];

  return (
    <>
      {contextHolder}
      <Card bordered={false} className="content-card">
        <Space className="mb-4" wrap>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={openCreate}>
            New task
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchAll}>
            Refresh
          </Button>
          <Button icon={<VideoCameraOutlined />} onClick={() => setRecorderOpen(true)}>
            Recorder
          </Button>
        </Space>
        <Alert
          className="mb-4"
          type="info"
          showIcon
          message="RPA uses managed Chromium profiles through CDP. Sensitive recovery/private-key inputs are blocked and require manual confirmation."
        />
        <Table
          rowKey="id"
          loading={loading}
          columns={taskColumns}
          dataSource={tasks}
          pagination={{pageSize: 8}}
        />
        <Typography.Title level={4}>Recent runs</Typography.Title>
        <Table
          rowKey="id"
          columns={runColumns}
          dataSource={runs}
          pagination={{pageSize: 5}}
        />
      </Card>

      <Drawer
        width={820}
        title={editingTask ? 'Edit RPA Task' : 'New RPA Task'}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setRecorderOpen(true)} icon={<VideoCameraOutlined />}>
              Recorder
            </Button>
            <Button type="primary" onClick={saveTask}>
              Save
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Name" rules={[{required: true}]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space wrap>
            <Form.Item name="defaultConcurrency" label="Concurrency">
              <InputNumber min={1} max={20} />
            </Form.Item>
            <Form.Item name="defaultTimeoutMs" label="Default timeout">
              <InputNumber min={100} step={1000} />
            </Form.Item>
            <Form.Item name="defaultRetry" label="Retry">
              <InputNumber min={0} max={5} />
            </Form.Item>
            <Form.Item name="screenshotPolicy" label="Screenshot">
              <Select
                style={{width: 140}}
                options={[
                  {label: 'On failure', value: 'on-failure'},
                  {label: 'Every step', value: 'every-step'},
                  {label: 'Never', value: 'never'},
                ]}
              />
            </Form.Item>
            <Form.Item name="closePolicy" label="After run">
              <Select
                style={{width: 160}}
                options={[
                  {label: 'Keep open', value: 'keepOpen'},
                  {label: 'Close on success', value: 'closeOnSuccess'},
                  {label: 'Close always', value: 'closeAlways'},
                ]}
              />
            </Form.Item>
            <Form.Item name="sessionMode" label="Session mode">
              <Select
                style={{width: 160}}
                options={sessionModeOptions}
              />
            </Form.Item>
          </Space>
          <Form.Item label="Profiles">
            <CheckboxGroup
              className="grid grid-cols-2 gap-2"
              options={windowOptions}
              value={selectedWindows}
              onChange={values => setSelectedWindows(values as number[])}
            />
          </Form.Item>
          <Form.Item name="variablesJson" label="Task variables JSON">
            <Input.TextArea rows={4} spellCheck={false} />
          </Form.Item>
          <Form.Item name="flowJson" label="Flow JSON" rules={[{required: true}]}>
            <Input.TextArea rows={18} spellCheck={false} />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        width={920}
        title={activeRun ? `RPA Run #${activeRun.id}` : 'RPA Run'}
        open={runDrawerOpen}
        onClose={() => setRunDrawerOpen(false)}
        extra={
          activeRun?.id ? (
            <Space>
              <Button icon={<ReloadOutlined />} onClick={refreshActiveRun} />
              <Button icon={<PauseCircleOutlined />} onClick={() => RpaBridge.pauseRun(activeRun.id!)}>
                Pause
              </Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => RpaBridge.resumeRun(activeRun.id!)}>
                Resume
              </Button>
              <Button danger icon={<StopOutlined />} onClick={() => RpaBridge.stopRun(activeRun.id!)}>
                Stop
              </Button>
            </Space>
          ) : null
        }
      >
        {activeRun && (
          <Space direction="vertical" className="w-full">
            <Space wrap>
              <Tag color={statusColor(activeRun.status)}>{activeRun.status}</Tag>
              <Text>{activeRun.message}</Text>
              {activeRun.artifact_root && <Text code copyable>{activeRun.artifact_root}</Text>}
            </Space>
            <Table
              rowKey="id"
              size="small"
              columns={runStepColumns}
              dataSource={activeRun.steps || []}
              pagination={{pageSize: 12}}
            />
          </Space>
        )}
      </Drawer>

      <Modal
        width={760}
        title="RPA Recorder"
        open={recorderOpen}
        onCancel={() => setRecorderOpen(false)}
        footer={
          <Space>
            <Button disabled={!recorderSession} onClick={stopRecorder}>
              Stop
            </Button>
            <Button disabled={!!recorderSession} type="primary" onClick={startRecorder}>
              Start
            </Button>
            <Button disabled={!!recorderSession || recorderEvents.length === 0} onClick={clearRecorderEvents}>
              Clear
            </Button>
            <Button onClick={appendRecorderSteps}>
              Append steps
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" className="w-full">
          <Select
            className="w-full"
            placeholder="Select recording profile"
            value={recorderWindowId}
            options={windowOptions}
            onChange={setRecorderWindowId}
          />
          <Select
            className="w-full"
            value={recorderSessionMode}
            options={sessionModeOptions}
            onChange={setRecorderSessionMode}
            disabled={!!recorderSession}
          />
          {recorderSession && <Alert type="warning" showIcon message="Recording is active in the selected profile." />}
          {!recorderSession && recorderEvents.length > 0 && (
            <Alert
              type="info"
              showIcon
              message="Click Append steps to add these events to the current Flow JSON, or Clear to discard and record again."
            />
          )}
          <Table
            rowKey="timestamp"
            size="small"
            columns={[
              {title: 'Type', dataIndex: 'type', width: 100},
              {title: 'Selector', dataIndex: 'selector'},
              {title: 'Value', dataIndex: 'value', width: 160},
            ]}
            dataSource={recorderEvents}
            pagination={{pageSize: 8}}
          />
        </Space>
      </Modal>
    </>
  );
};

export default Rpa;
