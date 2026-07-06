import type {TabsProps} from 'antd';
import {Button, Card, Modal, Space, Tabs, Typography, message} from 'antd';
import './index.css';
import WindowEditForm from '../components/edit-form';
import WindowImportForm from '../components/import-form';
import {useCallback, useEffect, useState} from 'react';
import type {DB, SafeAny} from '../../../../../shared/types/db';
import {useSearchParams} from 'react-router-dom';
import {WindowBridge} from '#preload';
import FingerprintInfo from '../components/fingerprint-info';
import WindowDetailFooter from '../components/edit-footer';
import {useTranslation} from 'react-i18next';
import type {ProfileStorageStatus} from '../../../../../shared/types/profile';

const {Text} = Typography;

const WindowDetailTabs = ({
  formValue,
  onChange,
  formValueChangeCallback,
}: {
  formValue: DB.Window;
  fingerprints?: SafeAny;
  onChange: (key: string) => void;
  formValueChangeCallback: (changed: DB.Window, data: DB.Window) => void;
}) => {
  const {t} = useTranslation();
  const DEFAULT_ACTIVE_KEY = '0';
  const items: TabsProps['items'] = [
    {
      key: 'windowForm',
      label: t('window_detail_create'),
      forceRender: true,
      children: (
        <div className="flex w-full">
          {WindowEditForm({
            loading: false,
            formValue: formValue,
            formChangeCallback: formValueChangeCallback,
          })}
          {/* {FingerprintInfo({fingerprints})} */}
        </div>
      ),
    },
    {
      key: 'import',
      label: t('window_detail_import'),
      children: WindowImportForm(),
    },
  ];

  return (
    <Tabs
      size="small"
      defaultActiveKey={DEFAULT_ACTIVE_KEY}
      items={items}
      onChange={onChange}
    />
  );
};

const WindowDetail = () => {
  // const [formValue, setFormValue] = useState<DB.Window>({});
  const [formValue, setFormValue] = useState<DB.Window>(new Object());
  const [currentTab, setCurrentTab] = useState('windowForm');
  const [searchParams] = useSearchParams();
  const [fingerprints, setFingerprints] = useState<SafeAny>(new Object());
  const [loading, setLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStorageStatus>();
  const [profileStatusVisible, setProfileStatusVisible] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    initFormValue();
  }, [searchParams]);

  const fetchFingerprints = async (windowId?: number) => {
    try {
      // eslint-disable-next-line no-unsafe-optional-chaining
      const data = await WindowBridge?.getFingerprint(windowId);
      setFingerprints(data);
    } catch (error) {
      setFingerprints(new Object());
      console.log(error);
    }
  };

  const initFormValue = async () => {
    const id = searchParams.get('id');
    setLoading(true);
    if (id) {
      const window = await WindowBridge?.getById(Number(id));
      if (window.tags) {
        if (typeof window.tags === 'string') {
          window.tags = window.tags.split(',').map((item: string) => Number(item));
        } else if (typeof window.tags === 'number') {
          window.tags = [window.tags];
        }
      } else {
        window.tags = [];
      }
      setFormValue(window || new Object());
      fetchFingerprints(Number(id));
    } else {
      setFormValue(new Object());
      fetchFingerprints();
    }
    setLoading(false);
  };

  const onTabChange = useCallback((tab: string) => {
    setCurrentTab(tab);
  }, []);

  const formValueChangeCallback = (changed: DB.Window, _: DB.Window) => {
    const newFormValue = {
      ...formValue,
      ...changed,
    };
    setFormValue(newFormValue);
    // setFormValue(data);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit++;
    }
    return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const backupProfile = async () => {
    if (!formValue.id) return;
    const result = await WindowBridge.backupProfile(formValue.id);
    messageApi[result.success ? 'success' : 'error'](result.message);
  };

  const showProfileStatus = async () => {
    if (!formValue.id) return;
    const status = await WindowBridge.getProfileStorageStatus(formValue.id);
    setProfileStatus(status);
    setProfileStatusVisible(true);
  };

  return (
    <>
      {contextHolder}
      <Card className="window-detail-card">
        {searchParams.get('id') ? (
          <>
            <Space className="mb-3">
              <Button onClick={showProfileStatus}>Profile status</Button>
              <Button onClick={backupProfile}>Backup profile</Button>
            </Space>
            <div className="flex w-full mt-4">
              <WindowEditForm
                loading={loading}
                formValue={formValue}
                formChangeCallback={formValueChangeCallback}
              ></WindowEditForm>
              <FingerprintInfo
                fingerprints={fingerprints}
                windowId={formValue.id}
              />
            </div>
          </>
        ) : (
          <WindowDetailTabs
            formValue={formValue}
            onChange={onTabChange}
            fingerprints={fingerprints}
            formValueChangeCallback={formValueChangeCallback}
          />
        )}
      </Card>
      <WindowDetailFooter
        loading={loading}
        currentTab={currentTab}
        formValue={formValue}
        fingerprints={fingerprints}
      />
      <Modal
        title="Profile Status"
        open={profileStatusVisible}
        centered
        footer={null}
        onCancel={() => setProfileStatusVisible(false)}
      >
        {profileStatus && (
          <Space direction="vertical" className="w-full">
            <Text code>{profileStatus.profileId}</Text>
            <Text copyable={{text: profileStatus.path}} ellipsis={{tooltip: profileStatus.path}}>
              {profileStatus.path}
            </Text>
            <Text>Exists: {profileStatus.exists ? 'Yes' : 'No'}</Text>
            <Text>Running: {profileStatus.running ? 'Yes' : 'No'}</Text>
            <Text>Size: {formatBytes(profileStatus.sizeBytes)}</Text>
            <Text>Permissions: {profileStatus.permissions || '-'}</Text>
            <Text>Health: {profileStatus.health}</Text>
            {profileStatus.issues.map(issue => (
              <Text key={issue} type="warning">
                {issue}
              </Text>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
};

export default WindowDetail;
