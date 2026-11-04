import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { usage_state_path } from './usage-state-path'

const USER_HOME = '/user-home'
const CUSTOM_DIRECTORY = '/custom-claude'
const FILE_NAME = 'usage.json'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

it('uses one account-wide path independent of the current repository', () => {
	vi.stubEnv('CLAUDE_CONFIG_DIR', undefined)
	vi.spyOn(os, 'homedir').mockReturnValue(USER_HOME)

	expect(usage_state_path.claude()).toBe(path.join(USER_HOME, '.claude', 'josh', FILE_NAME))
})

it('respects a custom Claude configuration directory', () => {
	vi.stubEnv('CLAUDE_CONFIG_DIR', CUSTOM_DIRECTORY)

	expect(usage_state_path.claude()).toBe(path.join(CUSTOM_DIRECTORY, 'josh', FILE_NAME))
})
