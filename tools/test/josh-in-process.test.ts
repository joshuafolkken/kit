import { realpathSync } from 'node:fs'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'
import { josh_in_process } from './josh-in-process'
import { temporary_directory } from './temporary-directory'

const LANE_MARK = 'JOSH_LANE_CHILD'
const GIT_DIR = 'GIT_DIR'
const OUTSIDE_LANE_MARK = '9116'
const OUTSIDE_GIT_DIR = '/elsewhere/.git'
const FAILURE_EXIT_CODE = 3
const ARGV: ReadonlyArray<string> = ['metrics', '--totals-only']
const BYTES = new TextEncoder().encode('bytes\n')

interface Seen {
	cwd: string
	lane_mark: string | undefined
	git_dir: string | undefined
}

const create_directory = temporary_directory()
const fixture = { root: '' }
const saved = { lane_mark: process.env[LANE_MARK], git_dir: process.env[GIT_DIR] }
const seen: Array<Seen> = []

function restore(name: string, value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, name)
	else process.env[name] = value
}

async function write_and_fail(argv: ReadonlyArray<string>): Promise<number> {
	process.stdout.write(`${argv.join(' ')}\n`)
	process.stdout.write(BYTES)
	process.stderr.write('warned\n')

	return await FAILURE_EXIT_CODE
}

async function look_around(): Promise<number> {
	seen.push({
		cwd: process.cwd(),
		lane_mark: process.env[LANE_MARK],
		git_dir: process.env[GIT_DIR],
	})

	return 0
}

async function throw_error(): Promise<number> {
	throw new Error('broke')
}

beforeEach(() => {
	fixture.root = realpathSync(create_directory('josh-in-process-'))
	seen.length = 0
	process.env[LANE_MARK] = OUTSIDE_LANE_MARK
	process.env[GIT_DIR] = OUTSIDE_GIT_DIR
})

afterEach(() => {
	restore(LANE_MARK, saved.lane_mark)
	restore(GIT_DIR, saved.git_dir)
})

describe('josh_in_process.run_in_process', () => {
	it('answers the exit code and what the run wrote to each stream', async () => {
		const result = await josh_in_process.run_in_process(fixture.root, write_and_fail, ARGV)

		expect(result).toStrictEqual({
			exit_code: FAILURE_EXIT_CODE,
			stdout: 'metrics --totals-only\nbytes\n',
			stderr: 'warned\n',
			is_timed_out: false,
		})
	})

	it("runs in the root with the child's variables, then puts this process back", async () => {
		const cwd = process.cwd()

		await josh_in_process.run_in_process(fixture.root, look_around, [])

		expect(seen).toStrictEqual([
			{
				cwd: fixture.root,
				lane_mark: josh_harness.CHILD_ENVIRONMENT[LANE_MARK],
				git_dir: undefined,
			},
		])
		expect(process.cwd()).toBe(cwd)
		expect(process.env[LANE_MARK]).toBe(OUTSIDE_LANE_MARK)
		expect(process.env[GIT_DIR]).toBe(OUTSIDE_GIT_DIR)
	})
})

describe('josh_in_process.run_in_process — a run that throws', () => {
	it('puts the directory, the variables and the streams back when the run throws', async () => {
		const cwd = process.cwd()
		const { write } = process.stdout

		await expect(josh_in_process.run_in_process(fixture.root, throw_error, [])).rejects.toThrow(
			'broke',
		)
		expect(process.cwd()).toBe(cwd)
		expect(process.env[LANE_MARK]).toBe(OUTSIDE_LANE_MARK)
		expect(process.env[GIT_DIR]).toBe(OUTSIDE_GIT_DIR)
		expect(process.stdout.write).toBe(write)
	})
})
