// Runs the backend Maven wrapper with the right script for the OS (npm uses cmd.exe on Windows).
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const backendDir = path.resolve(import.meta.dirname, '../apps/backend')
const isWindows = process.platform === 'win32'
const command = isWindows ? `"${path.join(backendDir, 'mvnw.cmd')}"` : './mvnw'

const result = spawnSync(command, process.argv.slice(2), {
  cwd: backendDir,
  stdio: 'inherit',
  shell: isWindows,
})
process.exit(result.status ?? 1)
