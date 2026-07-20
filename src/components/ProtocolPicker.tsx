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
    subtitle: '更通用，适合主流客户端和常规 TCP 场景。',
    transport: 'TCP',
    firewall: '云防火墙 / 安全组放行 TCP 端口',
    scenario: '主流客户端与常规网络环境，兼容性优先',
  },
  {
    id: 'hysteria2',
    title: 'Hysteria 2',
    subtitle: '偏重高吞吐和弱网表现，配置更直接。',
    transport: 'UDP（QUIC）',
    firewall: '云防火墙 / 安全组必须放行 UDP 端口',
    scenario: '高吞吐、弱网与移动网络环境',
  },
];

const comparisonRows: Array<{ label: string; pick: (card: (typeof protocolCards)[number]) => string }> = [
  { label: '传输层', pick: (card) => card.transport },
  { label: '防火墙要求', pick: (card) => card.firewall },
  { label: '适用场景', pick: (card) => card.scenario },
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
      ? '监听端口必须是 1–65535 之间的整数'
      : undefined;
  const sniError =
    value.protocol === 'vless-reality' && !isValidSni(value.sni)
      ? 'SNI 必须是有效域名，例如 www.microsoft.com'
      : undefined;
  const nodeNameError =
    value.nodeName.trim() && !isValidNodeName(value.nodeName)
      ? `节点名称不能超过 ${MAX_NODE_NAME_LENGTH} 个字符`
      : undefined;

  return (
    <Card padding="lg">
      <div className="border-b border-surface-border pb-4 dark:border-surface-700">
        <h2 className="text-base font-semibold text-surface-800 dark:text-surface-100">
          命名节点并选择协议
        </h2>
        <p className="mt-1 text-sm text-surface-500 dark:text-surface-400">
          节点名称独立于 VPS 名称，可以在同一台机器上部署多个协议实例。
        </p>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <Field
          label="节点名称"
          hint="这是客户端看到的节点名称，不会覆盖 VPS 卡片名称。"
          error={nodeNameError}
          required
        >
          <input
            className={inputClass}
            value={value.nodeName}
            maxLength={MAX_NODE_NAME_LENGTH}
            onChange={(event) => onChange({ ...value, nodeName: event.target.value })}
            placeholder="例如：主线路 VLESS / 游戏专用 Hysteria2"
          />
        </Field>

        <Field
          label="监听端口"
          hint={
            value.protocol === 'vless-reality'
              ? 'VLESS Reality 建议优先使用 443；如被占用再换其它未占用 TCP 端口。'
              : '建议使用 10000-60000 之间的未占用 UDP 端口。'
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

      <Callout variant="info" title="命名规则已拆分" className="mt-6">
        VPS 名称用于分组和复用登录资料，节点名称只描述当前协议实例。你可以在同一台 VPS
        下创建多个不同名称的节点。
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
                  {card.id === 'hysteria2' ? '需放行 UDP' : '需放行 TCP'}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>

      {/* 两协议逐项对照（同一 protocolCards 数据源渲染，选中列高亮） */}
      <div className="mt-4 overflow-hidden rounded-card border border-surface-border dark:border-surface-700">
        <table className="w-full text-sm">
          <caption className="sr-only">VLESS Reality 与 Hysteria 2 协议对比</caption>
          <thead>
            <tr className="bg-surface-50 text-left dark:bg-surface-900">
              <th
                scope="col"
                className="w-24 px-4 py-2.5 text-xs font-medium text-surface-500 dark:text-surface-400"
              >
                对比项
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
                  {value.protocol === card.id ? '（当前选择）' : ''}
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
                hint="仅 VLESS Reality 需要，建议使用常见站点域名。"
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
              <Callout variant="info" title="部署后自动验证" className="mt-auto">
                程序会在部署完成后自动从当前机器验证目标 TCP 端口是否真的能从公网连通。
              </Callout>
            </div>
          ) : (
            <Callout variant="warning" title="Hysteria 2 配置说明" className="flex-1">
              当前协议不需要 SNI，但云厂商安全组必须放行对应 UDP
              端口，否则客户端会直接无法连接。
            </Callout>
          )}
        </div>

        <Card padding="md" className="min-h-[11.5rem] bg-surface-50 dark:bg-surface-900">
          <p className="text-sm font-semibold text-surface-800 dark:text-surface-100">部署建议</p>
          <ul className="mt-3 space-y-2 text-sm text-surface-500 dark:text-surface-400">
            <li>使用不同节点名称区分用途，例如主线路、备用线路、UDP 专线。</li>
            <li>VLESS Reality 优先使用 443 或 8443，Hysteria2 建议使用高位 UDP 端口。</li>
            <li>如果更换协议或端口，建议同时更新云安全组规则。</li>
          </ul>
        </Card>
      </div>
    </Card>
  );
}
