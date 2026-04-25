import { describe, expect, it } from 'vitest'
import { MAINTENANCE_COMMANDS } from './josh-commands-maintenance'

const LATEST_UPDATE_NOT_DEFINED = 'latest:update command not defined'
const LATEST_NOT_DEFINED = 'latest command not defined'

describe('MAINTENANCE_COMMANDS latest:update', () => {
	it('uses latest-update.ts script instead of pnpm update --latest', () => {
		const cmd = MAINTENANCE_COMMANDS['latest:update']
		if (!cmd) throw new Error(LATEST_UPDATE_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/latest-update.ts')
		expect(cmd.shell).toBeUndefined()
	})
})

describe('MAINTENANCE_COMMANDS latest', () => {
	const { latest: cmd } = MAINTENANCE_COMMANDS

	it('does not call pnpm update --latest directly', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').not.toContain('pnpm update --latest')
	})

	it('delegates dependency updates to josh latest:update', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').toContain('latest:update')
	})
})
