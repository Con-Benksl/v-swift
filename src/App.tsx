import { useEffect, useState, type MouseEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import ControlPanel from './pages/ControlPanel';
import NodeDetail from './pages/NodeDetail';
import NewNodeWizard from './pages/NewNodeWizard';
import NodeList from './pages/NodeList';
import { ToastProvider, useToast } from './components/ui';
import {
  DeploymentActivityProvider,
  useDeploymentActivity,
} from './lib/deploymentActivity';
import logoUrl from './assets/v-swift-logo.svg';
import { NAVIGATION_BLOCKED_EVENT } from './lib/navigationGuard';

/* ---------------- 暗色模式 ---------------- */

const THEME_STORAGE_KEY = 'v-swift-theme';
type ThemePreference = 'system' | 'light' | 'dark';

/** 初始主题偏好：只有用户主动选择时才持久化；否则持续跟随系统。 */
function getInitialThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {
    /* localStorage 不可用时退回系统偏好 */
  }
  return 'system';
}

function useDarkMode(): [boolean, () => void] {
  const [preference, setPreference] = useState<ThemePreference>(getInitialThemePreference);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const dark = preference === 'system' ? systemDark : preference === 'dark';

  useEffect(() => {
    if (preference !== 'system') return;

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    try {
      if (preference === 'system') {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
    } catch {
      /* 持久化失败不影响当前会话内切换 */
    }
  }, [preference]);

  return [dark, () => setPreference(dark ? 'light' : 'dark')];
}

/* ---------------- 内联极简图标（24px viewBox，stroke 风格） ---------------- */

const iconClass = 'h-[18px] w-[18px] shrink-0';

function ServerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01" />
      <path d="M7 16.5h.01" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <path d="M4 8h9" />
      <path d="M19 8h1" />
      <circle cx="16" cy="8" r="2" />
      <path d="M4 16h3" />
      <path d="M13 16h7" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.9 4.9 1.4 1.4" />
      <path d="m17.7 17.7 1.4 1.4" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.3 17.7-1.4 1.4" />
      <path d="m19.1 4.9-1.4 1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={iconClass}
    >
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

/* ---------------- 侧边栏 ---------------- */

const NAV_ITEMS = [
  { to: '/', end: true, label: '节点列表', Icon: ServerIcon },
  { to: '/control', end: false, label: '控制面板', Icon: SlidersIcon },
] as const;

function SideNav() {
  const { active: deploymentActive } = useDeploymentActivity();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `group relative flex items-center justify-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium transition-colors duration-150 sm:justify-start ${deploymentActive ? 'cursor-not-allowed opacity-50' : ''} ${
      isActive
        ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-300'
        : 'text-surface-600 hover:bg-surface-100 hover:text-surface-800 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100'
    }`;
  const preventNavigationWhileDeploying = (event: MouseEvent<HTMLAnchorElement>) => {
    if (deploymentActive) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="主导航">
      {NAV_ITEMS.map(({ to, end, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={linkClass}
          aria-disabled={deploymentActive || undefined}
          onClick={preventNavigationWhileDeploying}
          title={deploymentActive ? '部署或订阅读取进行中，请稍候' : label}
        >
          {({ isActive }) => (
            <>
              {/* 当前项左缘指示条（仅展开态可见） */}
              <span
                aria-hidden="true"
                className={`absolute -left-3 hidden h-5 w-0.5 rounded-r-full bg-brand-600 transition-opacity duration-150 dark:bg-brand-400 sm:block ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <Icon />
              <span className="hidden sm:inline">{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const [dark, toggleDark] = useDarkMode();

  return (
    <button
      type="button"
      onClick={toggleDark}
      aria-pressed={dark}
      aria-label={dark ? '切换浅色模式' : '切换深色模式'}
      title={dark ? '切换浅色模式' : '切换深色模式'}
      className="flex w-full items-center justify-center gap-2.5 rounded-control px-3 py-2 text-sm font-medium text-surface-600 transition-colors duration-150 hover:bg-surface-100 hover:text-surface-800 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-100 sm:justify-start"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
      <span className="hidden sm:inline">{dark ? '切换浅色模式' : '切换深色模式'}</span>
    </button>
  );
}

function Sidebar() {
  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-surface-border bg-surface-card transition-[width] duration-200 dark:border-surface-700 dark:bg-surface-900 sm:w-52">
      <div className="flex items-center justify-center gap-2.5 px-3 pb-5 pt-5 sm:justify-start sm:px-5">
        {/* 品牌区：logo 底部叠一层品牌色柔光，提升第一眼辨识度 */}
        <div className="relative shrink-0">
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-brand-500/25 blur-md dark:bg-brand-400/20"
          />
          <img src={logoUrl} alt="V-Swift" className="relative h-8 w-8" />
        </div>
        <div className="hidden min-w-0 sm:block">
          <h1 className="truncate text-base font-semibold tracking-tight text-surface-900 dark:text-surface-50">
            V-Swift
          </h1>
          <p className="text-xs text-surface-500 dark:text-surface-400">代理节点管理</p>
        </div>
      </div>
      <SideNav />
      <div className="mt-auto px-3 pb-4 pt-3">
        <ThemeToggle />
        <p className="mt-3 hidden px-3 text-[11px] tabular-nums text-surface-400 dark:text-surface-500 sm:block">
          v{__APP_VERSION__}
        </p>
      </div>
    </aside>
  );
}

/* ---------------- 应用外壳 ---------------- */

function AppShell() {
  const toast = useToast();

  useEffect(() => {
    const showNavigationWarning = () => {
      toast.info('远端任务进行中，已阻止离开当前页面。', { duration: 4000 });
    };
    window.addEventListener(NAVIGATION_BLOCKED_EVENT, showNavigationWarning);

    let disposed = false;
    let unlisten: (() => void) | undefined;
    if ('__TAURI_INTERNALS__' in window) {
      void listen('remote-mutation-close-blocked', () => {
        toast.info('远端变更尚未完成，窗口暂时不能关闭。', { duration: 5000 });
      }).then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      });
    }

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(NAVIGATION_BLOCKED_EVENT, showNavigationWarning);
    };
  }, [toast]);

  return (
    <div className="flex min-h-screen bg-surface dark:bg-surface-900">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <Routes>
          <Route path="/" element={<NodeList />} />
          <Route path="/control" element={<ControlPanel />} />
          <Route path="/new" element={<NewNodeWizard />} />
          <Route path="/nodes/:id" element={<NodeDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <DeploymentActivityProvider>
          <AppShell />
        </DeploymentActivityProvider>
      </ToastProvider>
    </HashRouter>
  );
}
