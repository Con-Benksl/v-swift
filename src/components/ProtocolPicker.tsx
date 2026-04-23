import { ProtocolId } from '../ipc/types';

export interface ProtocolPickerValue {
  nodeName: string;
  protocol: ProtocolId;
  port: number;
  sni: string;
}

interface ProtocolPickerProps {
  value: ProtocolPickerValue;
  onChange: (value: ProtocolPickerValue) => void;
}

const protocolCards: Array<{
  id: ProtocolId;
  title: string;
  subtitle: string;
  points: string[];
}> = [
  {
    id: 'vless-reality',
    title: 'VLESS Reality',
    subtitle: '更通用，适合主流客户端和常规 TCP 场景。',
    points: ['需要 SNI', '云防火墙放行 TCP', '兼容性较高'],
  },
  {
    id: 'hysteria2',
    title: 'Hysteria 2',
    subtitle: '偏重高吞吐和弱网表现，配置更直接。',
    points: ['UDP 友好', '云防火墙必须放行 UDP', '移动网络表现好'],
  },
];

export default function ProtocolPicker({ value, onChange }: ProtocolPickerProps) {
  const fieldClass =
    'mt-2 w-full rounded-2xl border border-slate-200 bg-slate-950/5 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-500/10';
  const minPort = value.protocol === 'vless-reality' ? 1024 : 1;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60">
      <div className="flex flex-col gap-2 border-b border-slate-100 pb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">步骤 2</p>
        <h2 className="text-2xl font-semibold text-slate-950">命名节点并选择协议</h2>
        <p className="text-sm text-slate-500">节点名称独立于 VPS 名称，可以在同一台机器上部署多个协议实例。</p>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">节点名称</span>
          <input
            className={fieldClass}
            value={value.nodeName}
            onChange={(event) => onChange({ ...value, nodeName: event.target.value })}
            placeholder="例如：主线路 VLESS / 游戏专用 Hysteria2"
          />
          <span className="mt-2 block text-xs text-slate-500">
            这是客户端看到的节点名称，不会覆盖 VPS 卡片名称。
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">监听端口</span>
          <input
            className={fieldClass}
            type="number"
            min={minPort}
            max={65535}
            value={value.port}
            onChange={(event) => onChange({ ...value, port: Number(event.target.value) || 0 })}
          />
          <span className="mt-2 block text-xs text-slate-500">
            {value.protocol === 'vless-reality'
              ? 'VLESS Reality 建议使用 1024-65535 之间的未占用 TCP 端口。'
              : '建议使用 10000-60000 之间的未占用 UDP 端口。'}
          </span>
        </label>
      </div>

      <div className="mt-6 rounded-3xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm font-semibold text-blue-900">命名规则已拆分</p>
        <p className="mt-2 text-sm text-blue-700">
          VPS 名称用于分组和复用登录资料，节点名称只描述当前协议实例。你可以在同一台 VPS 下创建多个不同名称的节点。
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {protocolCards.map((card) => {
          const selected = value.protocol === card.id;

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onChange({ ...value, protocol: card.id })}
              className={`rounded-3xl border p-5 text-left transition ${
                selected
                  ? 'border-blue-500 bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'border-slate-200 bg-slate-50 text-slate-900 hover:border-blue-300 hover:bg-blue-50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">{card.title}</h3>
                  <p className={`mt-2 text-sm ${selected ? 'text-blue-50' : 'text-slate-500'}`}>
                    {card.subtitle}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                    selected ? 'bg-white/15 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {card.id}
                </span>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {card.points.map((point) => (
                  <span
                    key={point}
                    className={`rounded-full px-3 py-1 text-xs ${
                      selected ? 'bg-white/10 text-blue-50' : 'bg-white text-slate-600'
                    }`}
                  >
                    {point}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {value.protocol === 'vless-reality' ? (
          <div className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Reality SNI</span>
              <input
                className={fieldClass}
                value={value.sni}
                onChange={(event) => onChange({ ...value, sni: event.target.value })}
                placeholder="www.microsoft.com"
              />
              <span className="mt-2 block text-xs text-slate-500">
                仅 VLESS Reality 需要，建议使用常见站点域名。
              </span>
            </label>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
              <p className="text-sm font-medium text-blue-900">部署后自动验证</p>
              <p className="mt-2 text-sm text-blue-700">
                程序会在部署完成后自动从当前机器验证目标 TCP 端口是否真的能从公网连通。
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
            <p className="text-sm font-medium text-amber-900">Hysteria 2 配置说明</p>
            <p className="mt-2 text-sm text-amber-700">
              当前协议不需要 SNI，但云厂商安全组必须放行对应 UDP 端口，否则客户端会直接无法连接。
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-sm font-medium text-slate-900">部署建议</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-600">
            <li>使用不同节点名称区分用途，例如主线路、备用线路、UDP 专线。</li>
            <li>同一台 VPS 上不同节点尽量使用不同端口，避免覆盖已有实例。</li>
            <li>如果更换协议或端口，建议同时更新云安全组规则。</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
