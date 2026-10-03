import { useTranslation } from 'react-i18next';
import { VpsProfileSummary } from '../../ipc/types';
import { selectClass, Skeleton } from '../ui';

interface VpsSelectorProps {
  profiles: VpsProfileSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function VpsSelector({ profiles, selectedId, onSelect, loading, disabled }: VpsSelectorProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Skeleton
        variant="block"
        className="h-9 w-56"
        aria-label={t('vpsSelector.loadingAriaLabel')}
      />
    );
  }

  return (
    <div className="relative w-56 sm:w-64">
      <select
        value={selectedId || ''}
        onChange={(e) => onSelect(e.target.value)}
        disabled={disabled || profiles.length === 0}
        className={`${selectClass} appearance-none pr-9`}
        aria-label={t('vpsSelector.selectAriaLabel')}
      >
        <option value="" disabled>
          {t('vpsSelector.placeholder')}
        </option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {t('vpsSelector.optionLabel', { name: profile.name, host: profile.host })}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
        <svg
          className="h-4 w-4 text-surface-500 dark:text-surface-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  );
}
