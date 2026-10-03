import { t } from 'i18next';
import { ProtocolId } from '../ipc/types';
import { isValidNodeName, isValidSni, MAX_NODE_NAME_LENGTH } from '../lib';
import { Badge, Card, Callout, Field, inputClass } from './ui';

export interface ProtocolPickerValue {
  nodeName: string;
  protocol: ProtocolId;
  port: number;
  sni: string;
}

const RECOMMENDED_SNIS_VLESS = [
  'www.bing.com',
  'www.cloudflare.com',
  'www.microsoft.com',
  'addons.mozilla.org',
  'www.apple.com',
  'www.yahoo.com',
] as const;

const RECOMMENDED_SNIS_HY2 = [
  'www.bing.com',
  'www.apple.com',
  'www.cloudflare.com',
  'www.microsoft.com',
] as const;

interface ProtocolPickerProps {
  value: ProtocolPickerValue;
  onChange: (value: ProtocolPickerValue) => void;
}

/** 结构化协议数据：卡片展示 + 逐项对照表共用同一份数据源 */
const protocolCards: Array<{
  id: ProtocolId;
  title: string;
  subtitle: string;
  transport: string;
  firewall: string;
  scenario: string;
}> = [
  {
    id: 'vless-reality',
    title: 'VLESS Reality',
    subtitle: t('protocolPicker.vlessSubtitle'),
    transport: t('protocolPicker.transportTcp'),
    firewall: t('protocolPicker.vlessFirewall'),
    scenario: t('protocolPicker.vlessScenario'),
  },
  {
    id: 'hysteria2',
    title: 'Hysteria 2',
    subtitle: t('protocolPicker.hysteria2Subtitle'),
    transport: t('protocolPicker.transportUdpQuic'),
    firewall: t('protocolPicker.hysteria2Firewall'),
    scenario: t('protocolPicker.hysteria2Scenario'),
  },
];

const comparisonRows: Array<{ label: string; pick: (card: (typeof protocolCards)[number]) => string }> = [
  { label: t('protocolPicker.rowTransport'), pick: (card) => card.transport },
  { label: t('protocolPicker.rowFirewall'), pick: (card) => card.firewall },
  { label: t('protocolPicker.rowScenario'), pick: (card) => card.scenario },
];

/** 右上角选中对勾（与档案卡统一的选择语言） */
function SelectedCheck() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white dark:bg-brand-500"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

/**
 * 步骤 2「命名节点并选择协议」：节点名称/端口字段 + 协议卡（浅底+描边+对勾）
 * + 两协议逐项对照表 + 协议相关配置区（统一 min-h 消除切换时高度突变）。
 */
export default function ProtocolPicker({ value, onChange }: ProtocolPickerProps) {
  const minPort = 1;
  const portError =
    !Number.isInteger(value.port) || value.port < minPort || value.port > 65535
      ? t('protocolPicker.errorPortRange')
      : undefined;
  const sniError =
    value.protocol === 'vless-reality' && !isValidSni(value.sni)
      ? t('protocolPicker.errorSniInvalid')
      : undefined;
  const nodeNameError =
    value.nodeName.trim() && !isValidNodeName(value.nodeName)
      ? t('protocolPicker.errorNodeNameTooLong', { max: MAX_NODE_NAME_LENGTH })
      : undefined;

  return (
    <Card padding="lg">
      <div className="border-b border-surface-border pb-4 dark:border-surface-700">
        <h2 className="text-base font-semibold text-surface-800 dark:text-surface-100">
          {t('protocolPicker.title')}
        </h2>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          {t('protocolPicker.subtitle')}
        </p>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Field
          label={t('protocolPicker.nodeNameLabel')}
          hint={t('protocolPicker.nodeNameHint')}
          error={nodeNameError}
          required
        >
          <input
            className={inputClass}
            value={value.nodeName}
            maxLength={MAX_NODE_NAME_LENGTH}
            onChange={(event) => onChange({ ...value, nodeName: event.target.value })}
            placeholder={t('protocolPicker.nodeNamePlaceholder')}
          />
        </Field>

        <Field
          label={t('protocolPicker.portLabel')}
          hint={
            value.protocol === 'vless-reality'
              ? t('protocolPicker.portHintVless')
              : t('protocolPicker.portHintHy2')
          }
          error={portError}
          required
        >
          <input
            className={inputClass}
            type="number"
            min={minPort}
            max={65535}
            step={1}
            inputMode="numeric"
            value={value.port}
            onChange={(event) => onChange({ ...value, port: Number(event.target.value) || 0 })}
          />
        </Field>
      </div>

      <Callout variant="info" title={t('protocolPicker.namingCalloutTitle')} className="mt-6">
        {t('protocolPicker.namingCalloutBody')}
      </Callout>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {protocolCards.map((card) => {
          const selected = value.protocol === card.id;

          return (
            <button
              key={card.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ ...value, protocol: card.id })}
              className={`relative rounded-card border p-4 text-left transition ${
                selected
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/10'
                  : 'border-surface-border bg-surface-card hover:border-brand-300 dark:border-surface-700 dark:bg-surface-800 dark:hover:border-brand-500'
              }`}
            >
              {selected ? <SelectedCheck /> : null}
              <div className="pr-6">
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-100">
                  {card.title}
                </h3>
                <p className="mt-1.5 text-sm text-surface-500 dark:text-surface-400">
                  {card.subtitle}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="neutral">{card.transport}</Badge>
                <Badge variant={card.id === 'hysteria2' ? 'warning' : 'info'}>
                  {card.id === 'hysteria2'
                    ? t('protocolPicker.badgeAllowUdp')
                    : t('protocolPicker.badgeAllowTcp')}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>

      {/* 两协议逐项对照（同一 protocolCards 数据源渲染，选中列高亮） */}
      <div className="mt-4 overflow-hidden rounded-card border border-surface-border dark:border-surface-700">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('protocolPicker.comparisonCaption')}</caption>
          <thead>
            <tr className="bg-surface-50 text-left dark:bg-surface-900">
              <th
                scope="col"
                className="w-24 px-4 py-2.5 text-xs font-medium text-surface-500 dark:text-surface-400"
              >
                {t('protocolPicker.comparisonHeader')}
              </th>
              {protocolCards.map((card) => (
                <th
                  key={card.id}
                  scope="col"
                  className={`px-4 py-2.5 text-xs font-semibold ${
                    value.protocol === card.id
                      ? 'text-brand-600 dark:text-brand-300'
                      : 'text-surface-500 dark:text-surface-400'
                  }`}
                >
                  {card.title}
                  {value.protocol === card.id ? t('protocolPicker.currentSelectionSuffix') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row) => (
              <tr
                key={row.label}
                className="border-t border-surface-border dark:border-surface-700"
              >
                <th
                  scope="row"
                  className="px-4 py-2.5 text-left text-xs font-medium text-surface-500 dark:text-surface-400"
                >
                  {row.label}
                </th>
                {protocolCards.map((card) => (
                  <td
                    key={card.id}
                    className={`px-4 py-2.5 ${
                      value.protocol === card.id
                        ? 'bg-brand-50/60 text-surface-800 dark:bg-brand-500/5 dark:text-surface-100'
                        : 'text-surface-500 dark:text-surface-400'
                    }`}
                  >
                    {row.pick(card)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 协议相关配置区：统一 min-h，消除切换协议时右栏高度突变 */}
      <div className="mt-6 grid gap-5 md:grid-cols-2 md:items-stretch">
        <div className="flex min-h-[11.5rem] flex-col">
          {value.protocol === 'vless-reality' ? (
            <div className="flex flex-1 flex-col gap-4">
              <Field
                label="Reality SNI"
                hint={t('protocolPicker.sniHint')}
                error={sniError}
                required
              >
                <input
                  className={inputClass}
                  value={value.sni}
                  onChange={(event) => onChange({ ...value, sni: event.target.value })}
                  placeholder="www.microsoft.com"
                  list="sni-suggestions"
                />
                <datalist id="sni-suggestions">
                  {(value.protocol === 'vless-reality'
                    ? RECOMMENDED_SNIS_VLESS
                    : RECOMMENDED_SNIS_HY2
                  ).map((host) => (
                    <option key={host} value={host} />
                  ))}
                </datalist>
              </Field>
              <Callout variant="info" title={t('protocolPicker.autoVerifyTitle')} className="mt-auto">
                {t('protocolPicker.autoVerifyBody')}
              </Callout>
            </div>
          ) : (
            <Callout variant="warning" title={t('protocolPicker.hy2NoteTitle')} className="flex-1">
              {t('protocolPicker.hy2NoteBody')}
            </Callout>
          )}
        </div>

        <Card padding="md" className="min-h-[11.5rem] bg-surface-50 dark:bg-surface-900">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">
            {t('protocolPicker.deployTipsTitle')}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-surface-500 dark:text-surface-400">
            <li>{t('protocolPicker.tip1')}</li>
            <li>{t('protocolPicker.tip2')}</li>
            <li>{t('protocolPicker.tip3')}</li>
          </ul>
        </Card>
      </div>
    </Card>
  );
}
