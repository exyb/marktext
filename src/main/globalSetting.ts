import path from 'path'
import { app } from 'electron'

// Set `__static` path to static files in production / development depending on the environment
// 修复: 使用系统 Electron 时,app.isPackaged 可能返回 true,需要同时检查 NODE_ENV
const getAppRootPath = () => {
  // 修复: 使用系统 Electron 时,app.isPackaged 可能返回 true
  // 所以需要同时检查 NODE_ENV
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development' || process.env.PERF_TESTING === 'true'

  if (!isDev) {
    return process.resourcesPath
  }
  // 开发模式: 使用 process.cwd()
  return process.cwd()
}

;(global as unknown as { __static: string }).__static = path
  .join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'static')
  .replace(/\\/g, '\\\\')
