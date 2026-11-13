import path from 'node:path'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { npm_acquisition } from '#scripts/registry-migration/npm-acquisition'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { build_upgrade_command } from './upgrade-shell-command'
import { create_version_command_config } from './version-command-config'

const KIT = '@joshuafolkken/kit'
const VERSION = '1.2.3'
const CONFIG = create_version_command_config({ package_name: KIT })
const REGISTRY = '--config.@joshuafolkken:registry=https://registry.npmjs.org/'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('kit npm upgrade acquisition', () => {
	it('overrides a global user scope mapping only for kit', () => {
		const command = build_upgrade_command(VERSION, false, CONFIG)

		expect(command.steps).toEqual([['pnpm', 'add', '-g', REGISTRY, `${KIT}@${VERSION}`]])
		expect(command.text).toBe(command.steps[0]?.join(' '))
	})

	it('uses the explicit project mapping after migration', () => {
		vi.spyOn(npm_acquisition, 'is_project_npm').mockReturnValue(true)
		const command = build_upgrade_command(VERSION, true, CONFIG)

		expect(command.steps[0]).toEqual(['pnpm', 'add', '-D', `${KIT}@${VERSION}`])
		expect(command.steps).toHaveLength(2)
	})

	it('reads the consumer root passed by propagation rather than the supplier cwd', () => {
		const root = '/consumer project'
		const reader = vi.spyOn(npm_acquisition, 'is_project_npm').mockReturnValue(true)
		const command = build_upgrade_command(VERSION, true, CONFIG, root)

		expect(reader).toHaveBeenCalledWith(root)
		expect(command.steps[0]).toEqual(['pnpm', 'add', '-D', `${KIT}@${VERSION}`])
	})

	it('verifies every existing scoped artifact before upgrading a project before migration', () => {
		vi.spyOn(npm_acquisition, 'is_project_npm').mockReturnValue(false)
		const command = build_upgrade_command(VERSION, true, CONFIG)

		expect(command.steps[0]).toEqual([
			'node',
			path.join(PACKAGE_DIR, 'dist/registry-migrate.mjs'),
			VERSION,
		])
		expect(command.steps[1]).toEqual(['pnpm', 'add', '-D', `${KIT}@${VERSION}`])
		expect(command.text).toBe(command.steps.map((step) => step.join(' ')).join(' && '))
	})
})

describe('other package upgrade compatibility', () => {
	it.each([true, false])('keeps registry routing and repair policy for local=%s', (is_local) => {
		const config = create_version_command_config({ package_name: '@other/tool' })
		const command = build_upgrade_command(VERSION, is_local, config)

		expect(command.steps[0]).toEqual(['pnpm', 'add', is_local ? '-D' : '-g', '@other/tool@1.2.3'])
		expect(command.text).not.toContain(REGISTRY)
		expect(command.text).not.toContain('registry-migrate')
	})
})
