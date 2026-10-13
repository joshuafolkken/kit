import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fresh_machine_script } from './fresh-machine-script'
import { fresh_machine_spec, type ScenarioInput } from './fresh-machine-spec'

const RUN_NAME = 'kit-test-lua-init-1'
const MARKER = 'marker.txt'
const FAILURE = 3
const sandbox = { home: '' }

interface Outcome {
	exit_code: number | undefined
	output: string
}

// The script is run by a real bash, with HOME pointed at a temporary directory, so what is asserted
// is what a container would print.
function run_script(input: Omit<ScenarioInput, 'name'>): Outcome {
	const script = fresh_machine_script.build(
		fresh_machine_spec.define({ name: 'kit-test', ...input }),
	)
	const result = execaSync('bash', ['-c', script], {
		env: { HOME: sandbox.home, RUN_NAME },
		all: true,
		reject: false,
	})

	return { exit_code: result.exitCode, output: result.all }
}

beforeEach(() => {
	sandbox.home = mkdtempSync(path.join(os.tmpdir(), 'josh-fresh-machine-script-'))
})

afterEach(() => {
	rmSync(sandbox.home, { recursive: true, force: true })
})

describe('fresh_machine_script.build', () => {
	it('prints each command, its output and its exit status', () => {
		const { exit_code, output } = run_script({ commands: ['echo hello'] })

		expect(output).toBe('\n$ echo hello\nhello\n[exit 0]')
		expect(exit_code).toBe(0)
	})

	it('runs the commands in a project directory named after the run', () => {
		run_script({ commands: [`pwd > ${MARKER}`] })

		expect(readFileSync(path.join(sandbox.home, RUN_NAME, MARKER), 'utf8').trim()).toMatch(
			new RegExp(`/${RUN_NAME}$`, 'u'),
		)
	})

	it('keeps the state one command leaves for the next', () => {
		const { output } = run_script({ commands: ['GREETING=hello', 'echo "$GREETING"'] })

		expect(output).toContain('$ echo "$GREETING"\nhello\n')
	})

	it('passes a command with single quotes through unchanged', () => {
		const { output } = run_script({ commands: [String.raw`printf '%s\n' "it's"`] })

		expect(output).toContain(`$ printf '%s\\n' "it's"\nit's\n[exit 0]`)
	})
})

describe('fresh_machine_script.build failures and probes', () => {
	it('ends at the first failing command with its status, before the probes', () => {
		const { exit_code, output } = run_script({
			commands: [`(exit ${String(FAILURE)})`, 'echo unreachable'],
			probes: ['echo probe'],
		})

		expect(exit_code).toBe(FAILURE)
		expect(output).toContain(`[exit ${String(FAILURE)}]`)
		expect(output).not.toContain('unreachable')
		expect(output).not.toContain('probe')
	})

	it('records a failing probe and the one after it without failing the run', () => {
		const { exit_code, output } = run_script({
			commands: ['true'],
			probes: ['definitely-not-a-command', 'echo second'],
		})

		expect(exit_code).toBe(0)
		expect(output).toContain('# probes')
		expect(output).toContain('[exit 127]')
		expect(output).toContain('$ echo second\nsecond\n[exit 0]')
	})

	it('copies the seed files in as the first logged command, only when there are any', () => {
		const with_files = fresh_machine_spec.define({
			name: 'kit-test',
			files: { [MARKER]: '' },
			commands: ['true'],
		})
		const without_files = fresh_machine_spec.define({ name: 'kit-test', commands: ['true'] })

		expect(fresh_machine_script.build(with_files)).toContain("step 'cp -R /seed/. .' || exit $?")
		expect(fresh_machine_script.build(without_files)).not.toContain('/seed')
	})
})
