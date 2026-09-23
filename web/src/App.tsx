import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/components/app-shell'
import { ChartsPage } from '@/pages/charts'
import { ConnectPage } from '@/pages/connect'
import { HistoryPage } from '@/pages/history'
import { LoginPage } from '@/pages/login'
import { LogsPage } from '@/pages/logs'
import { OptionsPage } from '@/pages/options'
import { SettingsPage } from '@/pages/settings'
import { ThemePreviewPage } from '@/pages/theme-preview'
import { SyncSetupPage } from '@/pages/sync-setup'

/**
 * 阶段一逐页迁移：已迁完的挂真实页面，未迁完的先占位并给「旧版页面」入口。
 * 迁移顺序见 docs/frontend-refactor.md（先易后难，进度历史最后）。
 */
export default function App() {
  return (
    <Routes>
      {/* 登录页在外壳之外：未登录时不该看到侧栏 */}
      <Route path="login" element={<LoginPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/logs" replace />} />
        <Route path="logs" element={<LogsPage />} />

        {/* 以下待迁移 */}
        <Route path="connect" element={<ConnectPage />} />
        <Route path="sync-setup" element={<SyncSetupPage />} />
        <Route path="charts" element={<ChartsPage />} />
        <Route path="options" element={<OptionsPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />

        <Route path="theme-preview" element={<ThemePreviewPage />} />

        <Route path="*" element={<Navigate to="/logs" replace />} />
      </Route>
    </Routes>
  )
}
