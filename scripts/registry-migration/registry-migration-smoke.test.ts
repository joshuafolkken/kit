import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const SCRIPT_NAME = 'registry-migration-smoke.sh'
const SCRIPT = path.join(import.meta.dirname, SCRIPT_NAME)
const COPY = 'consumer'
const make_directory = temporary_directory()

function smoke(arguments_: Array<string>): SpawnSyncReturns<string> {
	return spawnSync('bash', [SCRIPT, ...arguments_], {
		encoding: 'utf8',
		env: { ...process.env, SMOKE_LEAK_PROBE: 'leaked' },
	})
}

function work_with_copy(): string {
	// The copy's `$PWD` is the resolved path (macOS `/var` → `/private/var`).
	const work = realpathSync(make_directory('registry-migration-smoke-'))

	mkdirSync(path.join(work, COPY))

	return work
}

function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

describe(SCRIPT_NAME, () => {
	it('prints usage and exits 1 without a command', () => {
		const result = smoke([])

		expect(result.status).toBe(1)
		expect(result.stderr).toContain(`usage: ${SCRIPT_NAME}`)
	})

	it('prints usage and exits 1 for an unknown command', () => {
		expect(smoke(['unknown', '/tmp']).status).toBe(1)
	})

	it('hashes the three tracked files of a copy', () => {
		const work = work_with_copy()
		const files = { '.npmrc': 'a\n', 'package.json': '{}\n', 'pnpm-lock.yaml': 'b\n' }

		for (const [name, text] of Object.entries(files)) {
			writeFileSync(path.join(work, COPY, name), text)
		}

		const lines = smoke(['hash', work, COPY]).stdout.trim().split('\n')

		expect(lines).toStrictEqual(
			Object.entries(files).map(([name, text]) => `${sha256(text)}  ${name}`),
		)
	})
})

describe(`${SCRIPT_NAME} run`, () => {
	it('runs a command in the copy with an isolated HOME and no caller environment', () => {
		const work = work_with_copy()

		const result = smoke([
			'run',
			work,
			COPY,
			'sh',
			'-c',
			'echo "$HOME|$CI|${SMOKE_LEAK_PROBE-unset}|$PWD"',
		])
		const [output, exit_line] = result.stdout.trim().split('\n', 2)

		expect(output).toBe(`${path.join(work, 'home')}|1|unset|${path.join(work, COPY)}`)
		expect(exit_line).toMatch(/^exit: 0 /u)
	})

	it('reports a failing command with its exit status instead of aborting', () => {
		const result = smoke(['run', work_with_copy(), COPY, 'sh', '-c', 'exit 3'])

		expect(result.status).toBe(0)
		expect(result.stdout).toContain('exit: 3 (sh -c exit 3)')
	})
})
