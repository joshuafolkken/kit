import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { josh_cli_fixture } from './josh-cli-fixture'
import { josh_logic } from './josh-logic'

describe('josh completion', () => {
	it('prints every command name and alias (ac-2323882c)', () => {
		const result = josh_cli_fixture.run_josh(['completion', '--names'])

		expect(result.exit_code).toBe(0)
		expect(result.stdout.split('\n')).toStrictEqual(josh_logic.all_command_names())
	})

	it.each([
		{ name: 'missing', cli_arguments: [] },
		{ name: 'unknown', cli_arguments: ['--unknown'] },
		{ name: 'extra', cli_arguments: ['--names', 'extra'] },
	])('rejects $name arguments without stdout (ac-85572bc0)', ({ cli_arguments }) => {
		const launcher = josh_cli_fixture.SOURCE_JOSH
		const result = execaSync(
			launcher.executable,
			[...launcher.leading_arguments, 'completion', ...cli_arguments],
			{ cwd: josh_cli_fixture.REPO_ROOT, reject: false },
		)

		expect(result.exitCode).not.toBe(0)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain('Usage: josh completion --names')
	})
})
