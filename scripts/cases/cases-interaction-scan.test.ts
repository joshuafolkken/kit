import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Findings } from './cases-interaction-scan'

// joshuafolkken/kit#4491: the scan searches the repository for every other source that names the same
// state — by literal and by constant — and renders one line per state, variable and resident process.
// `git grep` is mocked, so the answers do not ride on the repository's current contents.

const read_mock = vi.hoisted(() => vi.fn<(argv: ReadonlyArray<string>) => Promise<string>>())

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: read_mock } }))

const { cases_interaction_scan } = await import('./cases-interaction-scan')

const GIT_USAGE_EXIT = 129
const MANY_SITES = 12
const LEDGER = '.josh/ledger'
const LEDGER_CONSTANT = 'LEDGER_DIRECTORY'
const SITE_A = 'scripts/a.ts:4'
const LOCK = 'p.lock'
const directory = mkdtempSync(path.join(tmpdir(), 'cases-scan-'))

function fixture(name: string, content: string): string {
	const target = path.join(directory, name)

	writeFileSync(target, content, 'utf8')

	return target
}

function exit_error(code: number): Error {
	return Object.assign(new Error(`git exited ${String(code)}`), { exitCode: code })
}

// Answer each `git grep -e <target>` from the table, and a miss as git's no-match exit.
function answer(table: ReadonlyMap<string, string>): void {
	read_mock.mockImplementation(async (argv) => {
		const stdout = table.get(argv[argv.indexOf('-e') + 1] ?? '')

		return stdout ?? (await Promise.reject(exit_error(1)))
	})
}

function lock_line(others: ReadonlyArray<string>, has_failed: boolean): string {
	const findings: Findings = {
		states: [{ path: LOCK, others, has_failed }],
		variables: [],
		residents: [],
	}

	return cases_interaction_scan.lines_for(findings, 'en')[0] ?? ''
}

const STATE_PATH = fixture(
	'ledger.ts',
	`const ${LEDGER_CONSTANT} = '${LEDGER}'\nuse(${LEDGER_CONSTANT})\n`,
)
const OWN_PATH = path.relative(process.cwd(), STATE_PATH)
const ENV_PATH = fixture('env.ts', "const v = process.env['GIT_DIR']\n")
const INERT_PATH = fixture('pure.ts', 'export const x = 1\n')
const DOC_PATH = fixture('doc.md', `'${LEDGER}' and process.env['CI']\n`)

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

beforeEach(() => {
	read_mock.mockReset()
})

describe('cases_interaction_scan.scan — shared state', () => {
	it('lists the other sources that name the state by literal or by constant, not itself', async () => {
		answer(
			new Map([
				[LEDGER, `${OWN_PATH}:1:x\n${SITE_A}:'${LEDGER}'\n`],
				[LEDGER_CONSTANT, `${OWN_PATH}:2:x\nscripts/b.ts:9:import { ${LEDGER_CONSTANT} }\n`],
			]),
		)

		const { states } = await cases_interaction_scan.scan([STATE_PATH])

		expect(states).toStrictEqual([
			{ path: LEDGER, others: [SITE_A, 'scripts/b.ts:9'], has_failed: false },
		])
	})

	it('drops a module that declares its own constant of the same name', async () => {
		answer(
			new Map([
				[
					LEDGER_CONSTANT,
					`scripts/c.ts:3:const ${LEDGER_CONSTANT} = '.josh/other'\nscripts/c.ts:8:x\n`,
				],
			]),
		)

		const { states } = await cases_interaction_scan.scan([STATE_PATH])

		expect(states[0]?.others).toStrictEqual([])
	})

	it('marks a state whose search never ran', async () => {
		read_mock.mockRejectedValue(exit_error(GIT_USAGE_EXIT))

		const { states } = await cases_interaction_scan.scan([STATE_PATH])

		expect(states[0]?.has_failed).toBe(true)
	})
})

describe('cases_interaction_scan.scan — firing', () => {
	it('reads no interaction from a non-source path or a source that names none', async () => {
		answer(new Map())

		const findings = await cases_interaction_scan.scan([DOC_PATH, INERT_PATH])

		expect(cases_interaction_scan.interactions_of(findings)).toStrictEqual([])
		expect(read_mock).not.toHaveBeenCalled()
	})

	it('answers env for a source that reads a variable', async () => {
		const findings = await cases_interaction_scan.scan([ENV_PATH])

		expect(cases_interaction_scan.interactions_of(findings)).toStrictEqual(['env'])
	})
})

describe('cases_interaction_scan.lines_for', () => {
	const states = [{ path: LEDGER, others: [SITE_A], has_failed: false }]

	it('renders the state with its other sites and its cases in Japanese', () => {
		const [line] = cases_interaction_scan.lines_for({ states, variables: [], residents: [] }, 'ja')

		expect(line).toBe(
			`共有状態 \`${LEDGER}\` (他の読み書き: ${SITE_A}): 他の書き手との並行書き込み / 他の読み手が古い形式・途中の状態を読む / 自分が書く前に他の書き手が消す`,
		)
	})

	it('renders variables and residents after the state in English', () => {
		const lines = cases_interaction_scan.lines_for(
			{ states, variables: ['GIT_DIR'], residents: ['daemon'] },
			'en',
		)

		expect(lines[1]).toBe(
			'environment variable `GIT_DIR`: unset / value inherited from the parent process (e.g. GIT_DIR) / differs between the lane work tree and main',
		)
		expect(lines[2]).toContain('resident process `daemon`: resident process is stale')
	})

	it('caps the listed sites and counts the rest', () => {
		const others = Array.from({ length: MANY_SITES }, (_unused, index) => `s.ts:${String(index)}`)

		expect(lock_line(others, false)).toContain('s.ts:9, +2)')
	})

	it.each([
		[false, 'none'],
		[true, 'search failed'],
	])('names no others with failure %s as %s', (has_failed, text) => {
		expect(lock_line([], has_failed)).toContain(`(also read or written by: ${text})`)
	})
})
