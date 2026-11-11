import type { LocalLaunch } from '#scripts/build/local-bin'
import { vi } from 'vitest'

// A `#scripts/build/local-bin` mock for a test that asserts a `pnpm exec` argument list rather than
// where the tool is installed: `direct_launch` keeps the list unchanged under a file the test can
// tell apart from pnpm's, and `resolve_package_bin` is a stub the test answers. The resolution
// itself is covered by `local-bin.test.ts` and `format.test.ts`.
const DIRECT_LAUNCH_FILE = 'direct-launch'

function direct_launch(_project_root: string, pnpm_arguments: ReadonlyArray<string>): LocalLaunch {
	return { file: DIRECT_LAUNCH_FILE, args: pnpm_arguments }
}

const resolve_package_bin = vi.fn<(...args: Array<string>) => string | undefined>()

export { DIRECT_LAUNCH_FILE, direct_launch, resolve_package_bin }
