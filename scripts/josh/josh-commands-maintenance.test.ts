import { describe, expect, it } from 'vitest'
import { MAINTENANCE_COMMANDS } from './josh-commands-maintenance'

const LATEST_UPDATE_COMMAND = 'latest:update'
const LATEST_COREPACK_COMMAND = 'latest:corepack'
const LATEST_GUARD_COMMAND = 'latest:guard'
const LATEST_UPDATE_NOT_DEFINED = 'latest:update command not defined'
const LATEST_NOT_DEFINED = 'latest command not defined'
const LATEST_COREPACK_NOT_DEFINED = 'latest:corepack command not defined'
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

		expect(cmd.shell?.join(' ') ?? '').toContain(LATEST_UPDATE_COMMAND)
	})

	it('delegates the pnpm corepack bump to josh latest:corepack', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		expect(cmd.shell?.join(' ') ?? '').toContain(LATEST_COREPACK_COMMAND)
	})

	// The lane refusal has to run before corepack, the first step that mutates package.json
	// (joshuafolkken/kit#2135) — otherwise a lane's corepack bump lands before the guard is reached.
	it('fronts the chain with the lane guard, ahead of corepack', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		const shell = cmd.shell?.join(' ') ?? ''

		expect(shell).toContain(LATEST_GUARD_COMMAND)
		expect(shell.indexOf(LATEST_GUARD_COMMAND)).toBeLessThan(shell.indexOf(LATEST_COREPACK_COMMAND))
	})

	// This is the run that rewrites the ranges, on a developer machine where safe-chain's shims are
	// on PATH — so it is the one place the check sees the same filtered registry a consumer does.
	// The `prepack` copy is the backstop, not the primary detector (#742).
	it('checks the rewritten ranges before reporting the update as finished', () => {
		if (!cmd) throw new Error(LATEST_NOT_DEFINED)

		const shell = cmd.shell?.join(' ') ?? ''

		expect(shell.indexOf('josh ranges')).toBeGreaterThan(shell.indexOf(LATEST_UPDATE_COMMAND))
	})
})
