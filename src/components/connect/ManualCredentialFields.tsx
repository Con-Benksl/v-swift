import { Field, inputClass, SegmentedControl, textareaClass } from '../ui';
import type { ConnectFormValue } from './types';

/** 手动凭据各字段的校验错误（由 ConnectForm 统一计算后下发） */
export interface ManualFieldErrors {
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  key?: string;
}

interface ManualCredentialFieldsProps {
  value: ConnectFormValue;
  /** 字段级错误（仅传需要显示的，父级负责 touched/提交态判断） */
  errors: ManualFieldErrors;
  onChange: (patch: Partial<ConnectFormValue>) => void;
  /** 字段被编辑时上报，用于字段级校验的 touched 联动 */
  onTouch: (field: string) => void;
}

/**
 * 新建连接的 SSH 凭据字段组：地址/端口/用户名 + 密码或私钥认证。
 * 认证方式切换使用 SegmentedControl，所有控件走 Field + 裸控件类。
 */
export function ManualCredentialFields({
  value,
  errors,
  onChange,
  onTouch,
}: ManualCredentialFieldsProps) {
  const isPassword = value.auth.kind === 'password';
  const isPrivateKey = value.auth.kind === 'privateKey';

  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="服务器 IP / 域名" error={errors.host} required className="md:col-span-1">
          <input
            className={inputClass}
            value={value.host}
            onChange={(event) => {
              onTouch('host');
              onChange({ host: event.target.value });
            }}
            placeholder="203.0.113.10"
          />
        </Field>
        <Field label="SSH 端口" error={errors.port} required hint="1–65535，默认 22">
          <input
            className={inputClass}
            type="number"
            min={1}
            max={65535}
            step={1}
            inputMode="numeric"
            value={value.port}
            onChange={(event) => {
              onTouch('port');
              onChange({ port: Number(event.target.value) || 0 });
            }}
          />
        </Field>
        <Field label="SSH 用户名" error={errors.user} required>
          <input
            className={inputClass}
            value={value.user}
            onChange={(event) => {
              onTouch('user');
              onChange({ user: event.target.value });
            }}
            placeholder="root"
          />
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium text-surface-700 dark:text-surface-300">认证方式</p>
        <SegmentedControl
          aria-label="认证方式"
          options={[
            { value: 'password', label: '密码' },
            { value: 'privateKey', label: '私钥' },
          ]}
          value={value.auth.kind}
          onChange={(kind) => {
            onChange({
              auth:
                kind === 'password'
                  ? { kind: 'password', password: '' }
                  : { kind: 'privateKey', key: '', passphrase: '' },
            });
          }}
        />

        {isPassword ? (
          <Field label="SSH 密码" error={errors.password} required className="mt-4">
            <input
              className={inputClass}
              type="password"
              value={value.auth.kind === 'password' ? value.auth.password : ''}
              onChange={(event) => {
                onTouch('password');
                onChange({ auth: { kind: 'password', password: event.target.value } });
              }}
              placeholder="请输入密码"
            />
          </Field>
        ) : null}

        {isPrivateKey ? (
          <div className="mt-4 grid gap-4">
            <Field label="私钥内容" error={errors.key} required>
              <textarea
                className={`${textareaClass} min-h-40 font-mono text-xs`}
                value={value.auth.kind === 'privateKey' ? value.auth.key : ''}
                onChange={(event) => {
                  onTouch('key');
                  onChange({
                    auth: {
                      kind: 'privateKey',
                      key: event.target.value,
                      passphrase:
                        value.auth.kind === 'privateKey' ? value.auth.passphrase : '',
                    },
                  });
                }}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </Field>
            <Field label="私钥口令（可选）" hint="如果私钥有加密口令，请在此填写">
              <input
                className={inputClass}
                type="password"
                value={value.auth.kind === 'privateKey' ? (value.auth.passphrase ?? '') : ''}
                onChange={(event) =>
                  onChange({
                    auth: {
                      kind: 'privateKey',
                      key: value.auth.kind === 'privateKey' ? value.auth.key : '',
                      passphrase: event.target.value,
                    },
                  })
                }
                placeholder="如果私钥有加密口令"
              />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}
