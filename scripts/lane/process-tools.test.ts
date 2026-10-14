import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { process_tools } from './process-tools'

const MISSING_COMMAND = '/nonexistent/bin/ps'

describe('process_tools.throw_if_missing', () => {
	it('refuses a command that does not exist, naming it', () => {
		const { error } = spawnSync(MISSING_COMMAND, ['-o', 'ppid=', '-p', '1'])

		expect(() => {
			process_tools.throw_if_missing(MISSING_COMMAND, error)
		}).toThrow('`ps` is not installed')
	})

	it('names the package that provides the tools', () => {
		expect(process_tools.missing_notice('pgrep')).toContain('procps')
	})

	it('lets a failure that is not a missing command through', () => {
		expect(() => {
			process_tools.throw_if_missing('pgrep', new Error('exit 1'))
		}).not.toThrow()
	})

	it('lets a spawn without an error through', () => {
		expect(() => {
			process_tools.throw_if_missing('pgrep', undefined)
		}).not.toThrow()
	})
})
