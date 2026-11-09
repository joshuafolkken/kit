import { execaSync } from 'execa'
import { describe, expect, it } from 'vitest'
import { josh_cli_fixture } from './josh-cli-fixture'
import { COMMAND_MAP } from './josh-command-map'
import { josh_completion_scripts } from './josh-completion-scripts'
import { josh_logic } from './josh-logic'

function run_completion_with_stderr(cli_arguments: ReadonlyArray<string>): {
	stdout: string
	stderr: string
	exit_code: number | undefined
} {
	const launcher = josh_cli_fixture.SOURCE_JOSH
	const result = execaSync(
		launcher.executable,
		[...launcher.leading_arguments, 'completion', ...cli_arguments],
		{ cwd: josh_cli_fixture.REPO_ROOT, reject: false },
	)

	return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode }
}

describe('josh completion', () => {
	it('prints every command name and alias (ac-2323882c)', () => {
		const result = josh_cli_fixture.run_josh(['completion', '--names'])

		expect(result.exit_code).toBe(0)
		expect(result.stdout.split('\n')).toStrictEqual(josh_logic.all_command_names())
	})
})

describe('josh completion <shell>', () => {
	it.each(josh_completion_scripts.SHELLS)(
		'prints a %s script that asks --names instead of embedding the names',
		(shell) => {
			const result = josh_cli_fixture.run_josh(['completion', shell])
			const embedded = josh_logic
				.all_command_names()
				.filter((name) => name.includes(':') && result.stdout.includes(name))

			expect(result.exit_code).toBe(0)
			expect(result.stdout).toContain('completion --names')
			expect(embedded).toStrictEqual([])
		},
	)
})

describe('josh completion registration', () => {
	it('lists --names and every shell as usage examples (ac-723a7b03)', () => {
		const examples = COMMAND_MAP['completion']?.usage?.examples.map((example) => example.arguments)

		expect(examples).toStrictEqual(['--names', ...josh_completion_scripts.SHELLS])
	})
})

describe('josh completion arguments', () => {
	it.each([
		{ name: 'missing', cli_arguments: [] },
		{ name: 'unknown', cli_arguments: ['--unknown'] },
		{ name: 'unknown shell', cli_arguments: ['powershell'] },
		{ name: 'extra', cli_arguments: ['--names', 'extra'] },
		{ name: 'extra shell', cli_arguments: ['zsh', 'extra'] },
	])('rejects $name arguments without stdout (ac-85572bc0, ac-e3baff9d)', ({ cli_arguments }) => {
		const result = run_completion_with_stderr(cli_arguments)

		expect(result.exit_code).not.toBe(0)
		expect(result.stdout).toBe('')
		expect(result.stderr).toContain(
			'Usage: josh completion --names | josh completion <zsh|bash|fish>',
		)
	})
})
