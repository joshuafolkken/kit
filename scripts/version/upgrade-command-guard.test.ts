import { describe, expect, it } from 'vitest'
import { is_no_op_upgrade_command, type InstalledVersions } from './upgrade-command-guard'

const APP_KIT = '@joshuafolkken/app-kit'
const KIT = '@joshuafolkken/kit'
const INSTALLED_APP_KIT = '2.0.0'
const NEWER_APP_KIT = '2.1.0'
const INSTALLED_KIT = '1.4.0'

function installed(entries: Array<[string, string | undefined]>): InstalledVersions {
	return new Map(entries)
}

const CURRENT: InstalledVersions = installed([
	[APP_KIT, INSTALLED_APP_KIT],
	[KIT, INSTALLED_KIT],
])

describe('is_no_op_upgrade_command with a single pin', () => {
	it('reports a no-op when the pinned version is already installed', () => {
		const command = `pnpm add -g ${APP_KIT}@${INSTALLED_APP_KIT}`

		expect(is_no_op_upgrade_command(command, CURRENT)).toBe(true)
	})

	it('reports no no-op when the pinned version is ahead of the installed one', () => {
		const command = `pnpm add -g ${APP_KIT}@${NEWER_APP_KIT}`

		expect(is_no_op_upgrade_command(command, CURRENT)).toBe(false)
	})

	it('reports no no-op when the pinned package is not installed at all', () => {
		const command = `pnpm add -g ${APP_KIT}@${INSTALLED_APP_KIT}`

		expect(is_no_op_upgrade_command(command, installed([[APP_KIT, undefined]]))).toBe(false)
	})
})

describe('is_no_op_upgrade_command with commands that carry no exact pin', () => {
	it('never claims a no-op for a dist-tag command, which can always resolve to something new', () => {
		expect(is_no_op_upgrade_command(`pnpm add -g ${APP_KIT}@latest`, CURRENT)).toBe(false)
	})

	it('never claims a no-op for an unpinned command', () => {
		expect(is_no_op_upgrade_command(`pnpm add -g ${APP_KIT}`, CURRENT)).toBe(false)
	})
})

describe('is_no_op_upgrade_command with several pins', () => {
	it('reports a no-op only when every pin is already installed', () => {
		const command = `pnpm add -g ${APP_KIT}@${INSTALLED_APP_KIT} ${KIT}@${INSTALLED_KIT}`

		expect(is_no_op_upgrade_command(command, CURRENT)).toBe(true)
	})

	it('reports no no-op when one of the pins would still change something', () => {
		const command = `pnpm add -g ${APP_KIT}@${INSTALLED_APP_KIT} ${KIT}@1.5.0`

		expect(is_no_op_upgrade_command(command, CURRENT)).toBe(false)
	})

	it('ignores unscoped path segments that are not version pins', () => {
		const command = `pnpm add -D ${KIT}@${INSTALLED_KIT} && node_modules/.bin/tsx node_modules/${KIT}/scripts/fix-gh-packages.ts`

		expect(is_no_op_upgrade_command(command, CURRENT)).toBe(true)
	})
})
