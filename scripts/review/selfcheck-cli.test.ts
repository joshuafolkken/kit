import { change_base } from '#scripts/git/change-base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selfcheck_cli } from './selfcheck-cli'
import { selfcheck_report } from './selfcheck-report'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('selfcheck_cli.run', () => {
	it('refuses an argument with the usage line and exit 2, before reading git', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await selfcheck_cli.run(['--all'])).toBe(selfcheck_report.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('usage: josh review:selfcheck')
	})
})

describe('selfcheck_cli.guarded', () => {
	it('answers a git call that throws with exit 2, never as 1 found or 0 pass', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		vi.spyOn(change_base, 'resolved').mockRejectedValue(new Error('no repository'))

		expect(await selfcheck_cli.guarded([])).toBe(selfcheck_report.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('review:selfcheck: Error: no repository')
	})
})

describe('selfcheck_cli.child_environment', () => {
	it('drops the parent pnpm script context, so a probe resolves its own cwd', () => {
		const root = '/lane/root'

		vi.stubEnv('INIT_CWD', root)
		vi.stubEnv('npm_package_json', `${root}/package.json`)
		vi.stubEnv('PNPM_SCRIPT_SRC_DIR', root)
		vi.stubEnv('JOSH_SESSION_LANG', 'ja')

		const environment = selfcheck_cli.child_environment()

		expect(environment['INIT_CWD']).toBeUndefined()
		expect(environment['npm_package_json']).toBeUndefined()
		expect(environment['PNPM_SCRIPT_SRC_DIR']).toBeUndefined()
		expect(environment['JOSH_SESSION_LANG']).toBe('ja')
	})
})
