import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync_configs } from './sync-configs'

const make_directory = temporary_directory()
const UNCHANGED_LABEL = 'unchanged'

const ctx = { work_directory: '', destination: '' }

beforeEach(() => {
	ctx.work_directory = make_directory('sync-configs-secretlint-')
	ctx.destination = path.join(ctx.work_directory, '.secretlintrc.json')
})

afterEach(() => {
	vi.restoreAllMocks()
})

function silence_console_info(): void {
	vi.spyOn(console, 'info').mockImplementation(() => {
		/* suppress */
	})
}

describe('sync_configs.sync_secretlint_config', () => {
	// Unlike the merge-based syncs, this one creates: consumers initialized before the
	// secretlint rule existed have no config, and the pre-commit hook fails without one.
	it('creates the config when it does not exist', () => {
		silence_console_info()
		sync_configs.sync_secretlint_config(ctx.destination)

		expect(readFileSync(ctx.destination, 'utf8')).toBe(init_logic.generate_secretlint_config())
	})

	// The rule list becomes project-owned once written — custom patterns and deliberate
	// exclusions must survive a sync.
	it('leaves an existing config untouched', () => {
		const customized = '{"rules":[{"id":"@secretlint/secretlint-rule-preset-recommend"}],"x":1}'

		writeFileSync(ctx.destination, customized)
		silence_console_info()
		sync_configs.sync_secretlint_config(ctx.destination)

		expect(readFileSync(ctx.destination, 'utf8')).toBe(customized)
	})

	it('logs unchanged when the config already exists', () => {
		writeFileSync(ctx.destination, init_logic.generate_secretlint_config())
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		sync_configs.sync_secretlint_config(ctx.destination)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining(UNCHANGED_LABEL))
	})
})
