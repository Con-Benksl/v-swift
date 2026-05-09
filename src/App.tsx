import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import ControlPanel from './pages/ControlPanel';
import NodeDetail from './pages/NodeDetail';
import NewNodeWizard from './pages/NewNodeWizard';
import NodeList from './pages/NodeList';
import logoUrl from './assets/v-swift-logo.svg';

function TopBar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-full px-4 py-2 text-sm font-medium transition ${
      isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
    }`;

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/60 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <div>
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="V-Swift" className="h-10 w-10 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-blue-600">Desktop Console</p>
              <h1 className="text-lg font-semibold text-slate-950">V-Swift</h1>
            </div>
          </div>
        </div>
        <nav className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 p-1">
          <NavLink to="/" end className={linkClass}>
            节点列表
          </NavLink>
          <NavLink to="/control" className={linkClass}>
            控制面板
          </NavLink>
          <NavLink to="/new" className={linkClass}>
            新建节点
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <TopBar />
        <main className="pt-16">
          <Routes>
            <Route path="/" element={<NodeList />} />
            <Route path="/control" element={<ControlPanel />} />
            <Route path="/new" element={<NewNodeWizard />} />
            <Route path="/nodes/:id" element={<NodeDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
