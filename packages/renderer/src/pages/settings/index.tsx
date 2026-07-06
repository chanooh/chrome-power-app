import {Alert, Button, Card, Form, Input, Select, Space, Tag} from 'antd';
import {CommonBridge} from '#preload';
import {useEffect, useState} from 'react';
import type {ManagedBrowserCoreStatus, SettingOptions} from '../../../../shared/types/common';
import {useTranslation} from 'react-i18next';

type FieldType = {
  profileCachePath: string;
  browserMode: 'managed' | 'local';
  managedBrowserRoot: string;
  managedBrowserVersion: string;
  managedBrowserManifestPath: string;
  useLocalChrome: boolean;
  localChromePath: string;
  chromiumBinPath: string;
  automationConnect: boolean;
};

const Settings = () => {
  const [formValue, setFormValue] = useState<SettingOptions>({
    profileCachePath: '',
    browserMode: 'managed',
    managedBrowserRoot: '',
    managedBrowserVersion: '',
    managedBrowserManifestPath: '',
    useLocalChrome: false,
    localChromePath: '',
    chromiumBinPath: '',
    automationConnect: false,
  });
  const [managedBrowserStatus, setManagedBrowserStatus] = useState<ManagedBrowserCoreStatus | null>(null);
  const [form] = Form.useForm();
  const {t} = useTranslation();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    const settings = await CommonBridge.getSettings();
    setFormValue(settings);
    form.setFieldsValue(settings);
    const status = await CommonBridge.getManagedBrowserStatus();
    setManagedBrowserStatus(status);
  };

  const handleSave = async (values: SettingOptions) => {
    await CommonBridge.saveSettings(values);
  };

  const handleChoosePath = async (
    field: 'profileCachePath' | 'localChromePath' | 'chromiumBinPath',
    type: 'openFile' | 'openDirectory',
  ) => {
    const path = await CommonBridge.choosePath(type);
    if (!formValue[field] || (path && formValue[field] !== path)) {
      handleFormValueChange({
        ...formValue,
        [field]: path,
      });
    }
  };

  const handleFormValueChange = (changed: Partial<SettingOptions>) => {
    const browserMode = changed.browserMode || formValue.browserMode;
    const newFormValue = {
      ...formValue,
      ...changed,
      browserMode,
      useLocalChrome: browserMode === 'local',
    };
    setFormValue(newFormValue);
    handleSave(newFormValue);
  };

  // type FieldType = SettingOptions;

  return (
    <>
      <Card
        className="content-card p-6"
        bordered={false}
      >
        <Form
          name="settingsForm"
          className="w-2/3"
          labelCol={{span: 5}}
          size="large"
          form={form}
          initialValues={formValue}
          onValuesChange={handleFormValueChange}
        >
          <Form.Item<FieldType>
            label={t('settings_cache_path')}
            name="profileCachePath"
          >
            <Space.Compact style={{width: '100%'}}>
              <Input
                readOnly
                disabled
                value={formValue.profileCachePath}
              />
              <Button
                type="default"
                onClick={() => handleChoosePath('profileCachePath', 'openDirectory')}
              >
                {t('settings_choose_cache_path')}
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item<FieldType>
            label={t('settings_browser_mode')}
            name="browserMode"
          >
            <Select
              value={formValue.browserMode}
              options={[
                {label: t('settings_browser_mode_managed'), value: 'managed'},
                {label: t('settings_browser_mode_local'), value: 'local'},
              ]}
            />
          </Form.Item>
          {formValue.browserMode === 'managed' ? (
            <>
              <Form.Item<FieldType>
                label={t('settings_managed_browser_version')}
                name="managedBrowserVersion"
              >
                <Input
                  readOnly
                  disabled
                  value={formValue.managedBrowserVersion}
                />
              </Form.Item>
              <Form.Item<FieldType>
                label={t('settings_managed_browser_root')}
                name="managedBrowserRoot"
              >
                <Input
                  readOnly
                  disabled
                  value={formValue.managedBrowserRoot}
                />
              </Form.Item>
              <Form.Item<FieldType>
                label={t('settings_managed_browser_manifest')}
                name="managedBrowserManifestPath"
              >
                <Input
                  readOnly
                  disabled
                  value={formValue.managedBrowserManifestPath}
                />
              </Form.Item>
              <Form.Item label={t('settings_managed_browser_status')}>
                <Space direction="vertical" style={{width: '100%'}}>
                  <Tag color={managedBrowserStatus?.available ? 'green' : 'red'}>
                    {managedBrowserStatus?.available
                      ? t('settings_managed_browser_ready')
                      : t('settings_managed_browser_missing')}
                  </Tag>
                  {managedBrowserStatus?.message ? (
                    <Alert
                      type={managedBrowserStatus.available ? 'success' : 'warning'}
                      message={managedBrowserStatus.message}
                      showIcon
                    />
                  ) : null}
                </Space>
              </Form.Item>
            </>
          ) : (
            <Form.Item<FieldType>
              label={t('settings_chrome_path')}
              name="localChromePath"
            >
              <Space.Compact style={{width: '100%'}}>
                <Input
                  readOnly
                  disabled
                  value={formValue.localChromePath}
                />
                <Button
                  type="default"
                  onClick={() => handleChoosePath('localChromePath', 'openFile')}
                >
                  {t('settings_choose_cache_path')}
                </Button>
              </Space.Compact>
            </Form.Item>
          )}
          {/* <Form.Item<FieldType>
            label={t('settings_automation_connect')}
            name="automationConnect"
            >
              <Switch value={formValue.automationConnect} />
          </Form.Item> */}
        </Form>
      </Card>
      {/* <div className="content-footer pl-24">
        <Button
          type="primary"
          className="w-20"
          onClick={() => handleSave(formValue)}
        >
          {t('footer_ok')}
        </Button>
      </div> */}
    </>
  );
};
export default Settings;
