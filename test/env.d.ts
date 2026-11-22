import type { D1Migration } from '@cloudflare/vitest-plugin'
import type { Env } from '../src/worker/index.ts'

declare global {
  namespace Cloudflare {
    interface Env extends EnvBindings {
      TEST_MIGRATIONS: D1Migration[]
    }
    interface GlobalProps {
      mainModule: typeof import('../src/worker/index.ts')
    }
  }
}
type EnvBindings = Env
