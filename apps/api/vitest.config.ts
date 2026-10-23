import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // unit tests only touch pure functions; config still validates these at import time
    env: { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/unused', JWT_SECRET: 'test-secret-test-secret-test-secret-00', NVIDIA_API_KEY: '', JOBS_ENABLED: 'false' },
  },
})
