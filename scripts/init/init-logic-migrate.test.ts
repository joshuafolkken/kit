import { safe_chain_preinstall } from '#scripts/safe-chain/preinstall-command'
import { describe, expect, it } from 'vitest'
import { init_logic_migrate } from './init-logic-migrate'

const { migrate_scripts } = init_logic_migrate

describe('init_logic_migrate.migrate_scripts', () => {
	it('replaces a safe-chain preinstall an earlier kit wrote', () => {
		const scripts = { preinstall: 'pnpm dlx @aikidosec/safe-chain setup-ci', dev: 'vite dev' }

		expect(migrate_scripts(scripts)).toStrictEqual({
			preinstall: safe_chain_preinstall.SAFE_CHAIN_CMD,
			dev: 'vite dev',
		})
	})

	// joshuafolkken/kit#4187: no consumer carries these any longer, so they are the project's own.
	it('keeps a jf- value, a pre-josh value and a retired script name as they are', () => {
		const scripts = {
			build: 'jf-build',
			lint: 'pnpm lint:prettier && pnpm lint:eslint',
			git: 'josh git',
		}

		expect(migrate_scripts(scripts)).toStrictEqual(scripts)
	})
})
