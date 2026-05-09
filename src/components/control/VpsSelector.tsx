import { VpsProfileSummary } from '../../ipc/types';

interface VpsSelectorProps {
  profiles: VpsProfileSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
}

export function VpsSelector({ profiles, selectedId, onSelect, loading }: VpsSelectorProps) {
  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-10 w-64 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="relative">
      <select
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value)}
        className="h-11 appearance-none rounded-2xl border border-slate-200 bg-white px-4 pr-10 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-300 hover:shadow-md focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      >
        <option value="" disabled>
          选择 VPS...
        </option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} ({profile.host})
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <svg
          className="h-5 w-5 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
