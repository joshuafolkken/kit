import { TS_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import { describe, expect, it } from 'vitest'
import { TSC_ARGS } from './tsc-arguments'

const NO_EMIT_PREFIX = ['exec', 'tsc', '--noEmit'] as const

describe('TSC_ARGS — the one tsc argument list', () => {
	it('is a no-emit tsc run through pnpm exec, followed by the incremental cache flags', () => {
		expect(TSC_ARGS).toEqual([...NO_EMIT_PREFIX, ...TS_CACHE_FLAGS])
	})
})
