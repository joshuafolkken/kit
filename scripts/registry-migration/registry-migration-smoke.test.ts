import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const SCRIPT_NAME = 'registry-migration-smoke.sh'
const SCRIPT = path.join(import.meta.dirname, SCRIPT_NAME)
const COPY = 'consumer'
const make_directory = temporary_directory()

const EXECUTABLE_MODE = 0o755

interface SmokeOptions {
	cwd?: string
	path_prefix?: string
}

function smoke(arguments_: Array<string>, options: SmokeOptions = {}): SpawnSyncReturns<string> {
	const prefix = options.path_prefix === undefined ? '' : `${options.path_prefix}:`

	return spawnSync('bash', [SCRIPT, ...arguments_], {
		cwd: options.cwd,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${prefix}${process.env['PATH'] ?? ''}`,
			SMOKE_LEAK_PROBE: 'leaked',
		},
	})
}

// A directory holding a stand-in `pnpm` that prints its label, optionally with `node` beside it.
function tool_directory(work: string, label: string, node?: string): string {
	const directory = path.join(work, label)
	const pnpm = path.join(directory, 'pnpm')

	mkdirSync(directory)
	writeFileSync(pnpm, `#!/bin/sh\necho ${label}\n`)
	chmodSync(pnpm, EXECUTABLE_MODE)
	if (node !== undefined) symlinkSync(node, path.join(directory, 'node'))

	return directory
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

describe(`${SCRIPT_NAME} run paths`, () => {
	it('keeps the isolated directories outside the copy for a relative work directory', () => {
		const work = work_with_copy()

		const result = smoke(['run', path.basename(work), COPY, 'sh', '-c', 'echo "$HOME"'], {
			cwd: path.dirname(work),
		})

		expect(result.stdout.split('\n', 1)[0]).toBe(path.join(work, 'home'))
	})

	it('prefers the pinned pnpm first on PATH over a pnpm beside node', () => {
		const work = work_with_copy()
		const pinned = tool_directory(work, 'pinned')
		const beside_node = tool_directory(work, 'beside-node', process.execPath)

		const result = smoke(['run', work, COPY, 'pnpm'], {
			path_prefix: `${pinned}:${beside_node}`,
		})

		expect(result.stdout.split('\n', 1)[0]).toBe('pinned')
	})
})
