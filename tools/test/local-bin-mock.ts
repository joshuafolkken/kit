import type { LocalLaunch } from '#scripts/build/local-bin'
import { vi } from 'vitest'

// A `#scripts/build/local-bin` mock for a test that asserts a `pnpm exec` argument list rather than
// where the tool is installed: `direct_launch` is held at its pnpm fallback, and
// `resolve_package_bin` is a stub the test answers. The direct route itself is covered by
// `local-bin.test.ts` and `format.test.ts`.
function direct_launch(_project_root: string, pnpm_arguments: ReadonlyArray<string>): LocalLaunch {
	return { file: 'pnpm', args: pnpm_arguments }
}

const resolve_package_bin = vi.fn<(...args: Array<string>) => string | undefined>()

export { direct_launch, resolve_package_bin }
