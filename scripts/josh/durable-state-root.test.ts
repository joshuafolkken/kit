import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { describe, expect, it } from 'vitest'
import { durable_state_root } from './durable-state-root'

const COMMON = '/repository/.git'

function common_git_directory(): string {
	return COMMON
}

function outside_repository(): undefined {
	return undefined
}

describe('durable_state_root.state_root', () => {
	it('places the records in the run-state entry of the common git directory', () => {
		expect(durable_state_root.state_root(undefined, common_git_directory)).toBe(
			path.join(COMMON, durable_state_root.STATE_DIRECTORY, 'run-state'),
		)
	})

	it('moves them beneath a temp-root override', () => {
		expect(durable_state_root.state_root('/override', common_git_directory)).toBe(
			path.join('/override', 'josh-state'),
		)
	})

	it('falls back to the temp root outside a repository', () => {
		expect(durable_state_root.state_root(undefined, outside_repository)).toBe(PLATFORM_TEMP_ROOT)
	})
})
