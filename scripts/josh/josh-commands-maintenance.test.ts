import { describe, expect, it } from 'vitest'
import { MAINTENANCE_COMMANDS } from './josh-commands-maintenance'

const LATEST_UPDATE_NOT_DEFINED = 'latest:update command not defined'
const LATEST_NOT_DEFINED = 'latest command not defined'
const LATEST_COREPACK_NOT_DEFINED = 'latest:corepack command not defined'
const SYNC_WORKFLOW_PINS_NOT_DEFINED = 'sync-workflow-pins command not defined'
const DOCTOR_NOT_DEFINED = 'doctor command not defined'

describe('MAINTENANCE_COMMANDS doctor', () => {
	it('uses the doctor script in the Maintenance category', () => {
		const { doctor: cmd } = MAINTENANCE_COMMANDS
		if (!cmd) throw new Error(DOCTOR_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/doctor/doctor.ts')
		expect(cmd.shell).toBeUndefined()
		expect(cmd.category).toBe('Maintenance')
	})
})

describe('MAINTENANCE_COMMANDS sync-workflow-pins', () => {
	it('uses the sync-workflow-pins script', () => {
		const cmd = MAINTENANCE_COMMANDS['sync-workflow-pins']
		if (!cmd) throw new Error(SYNC_WORKFLOW_PINS_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/sync/sync-workflow-pins.ts')
		expect(cmd.shell).toBeUndefined()
	})
})

describe('MAINTENANCE_COMMANDS latest:update', () => {
	it('uses latest-update.ts script instead of pnpm update --latest', () => {
		const cmd = MAINTENANCE_COMMANDS['latest:update']
		if (!cmd) throw new Error(LATEST_UPDATE_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/latest-update.ts')
		expect(cmd.shell).toBeUndefined()
	})
})

describe('MAINTENANCE_COMMANDS latest:corepack', () => {
	it('uses latest-corepack.ts script instead of hardcoding pnpm@latest', () => {
		const cmd = MAINTENANCE_COMMANDS['latest:corepack']
		if (!cmd) throw new Error(LATEST_COREPACK_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/latest-corepack.ts')
		expect(cmd.shell).toBeUndefined()
	})
})

describe('MAINTENANCE_COMMANDS latest', () => {
	const { latest: cmd } = MAINTENANCE_COMMANDS

	it('does not call pnpm update --latest directly', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').not.toContain('pnpm update --latest')
	})

	it('does not hardcode the volatile pnpm@latest dist-tag', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').not.toContain('pnpm@latest')
	})

	it('delegates dependency updates to josh latest:update', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').toContain('latest:update')
	})

	it('delegates the pnpm corepack bump to josh latest:corepack', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').toContain('latest:corepack')
	})
})
