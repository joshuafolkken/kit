import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_demoted } from './hook-demoted'
import { hook_ledger_cli, type LedgerContext } from './hook-ledger-cli'
import { hook_ledger_demote } from './hook-ledger-demote'

// joshuafolkken/kit#6591: `josh hook:ledger --period 7 --demote` lists only the rules the ledger shows
// refusing at least 10 times with half or more passing later in the same session; `--apply` records
// them in the demoted-rules file and `--restore <rule>` takes one back out. Ledger lines follow the
// #6587 format (`hook-ledger.ts`).

const make_directory = temporary_directory('test')
const NOW = new Date('2026-11-09T12:00:00.000Z')
const LEDGER_AT = '2026-11-09T10:00:01.000Z'
const PASSED_AT = '2026-11-09T10:05:00.000Z'
const MIN_REFUSALS = 10
const COMMAND = 'git push'
const PREFIX = 'josh hook:ledger:'
const DEMOTED_FILE = path.join('.josh', 'hook-demoted.json')

afterEach(() => {
	vi.restoreAllMocks()
})

function message(type: string, block: Record<string, unknown>): string {
	return JSON.stringify({ type, timestamp: PASSED_AT, message: { content: [block] } })
}

// A transcript where the refused `git push` later ran without an error.
function passing_transcript(root: string): string {
	const file = path.join(root, 'session.jsonl')
	const use = { type: 'tool_use', id: 'again', name: 'Bash', input: { command: COMMAND } }
	const result = { type: 'tool_result', tool_use_id: 'again', content: '', is_error: false }

	writeFileSync(file, [message('assistant', use), message('user', result)].join('\n'))

	return file
}

function refusals(rule: string, session: string, count: number): Array<string> {
	const entry = { at: LEDGER_AT, hook: 'pretool-guard', rule, tool: 'Bash', role: '', session }

	return Array.from({ length: count }, () => JSON.stringify({ ...entry, command: COMMAND }))
}

// `noisy` refuses 10 times and passes later every time; `rare` passes later but refuses only 9
// times; `firm` refuses 10 times and never passes later.
function context_of(): LedgerContext {
	const root = make_directory('hook-ledger-demote-test-')
	const directory = path.join(root, 'ledger')
	const session = passing_transcript(root)
	const lines = [
		...refusals('noisy', session, MIN_REFUSALS),
		...refusals('rare', session, MIN_REFUSALS - 1),
		...refusals('firm', '', MIN_REFUSALS),
	]

	mkdirSync(directory)
	writeFileSync(path.join(directory, '2026-11-09.jsonl'), `${lines.join('\n')}\n`)

	return {
		directory,
		now: NOW,
		read_issues: async () => [],
		demoted_file: path.join(root, DEMOTED_FILE),
	}
}

async function printed(argv: ReadonlyArray<string>, context: LedgerContext): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	expect(await hook_ledger_cli.run(argv, context)).toBe(0)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

function demoted(context: LedgerContext): unknown {
	return JSON.parse(readFileSync(context.demoted_file, 'utf8'))
}

describe('hook_ledger_cli.run --demote', () => {
	it('lists only the rule with 10 refusals half of which passed later', async () => {
		const output = await printed(['--period', '7', '--demote'], context_of())

		expect(output).toBe(`${PREFIX} demote noisy`)
	})

	it('records the listed rules with --apply, keeping those already demoted', async () => {
		const context = context_of()

		mkdirSync(path.dirname(context.demoted_file))
		writeFileSync(context.demoted_file, JSON.stringify({ rules: ['older'] }))

		const output = await printed(['--period', '7', '--demote', '--apply'], context)

		expect(output).toContain(`${PREFIX} recorded in ${context.demoted_file}`)
		expect(demoted(context)).toStrictEqual({ rules: ['noisy', 'older'] })
	})

	it('says so when no rule meets the demotion rule, writing nothing', async () => {
		const file = path.join(make_directory('hook-ledger-demote-none-'), DEMOTED_FILE)

		expect(await hook_ledger_demote.report([], true, file)).toBe(
			`${PREFIX} no rule meets the demotion rule`,
		)
		expect(existsSync(file)).toBe(false)
	})
})

describe('hook_ledger_cli.run --restore', () => {
	it('takes a demoted rule back out of the file', async () => {
		const context = context_of()

		await hook_demoted.write_rules(new Set(['noisy']), context.demoted_file)

		expect(await printed(['--restore', 'noisy'], context)).toBe(
			`${PREFIX} restored noisy to blocking`,
		)
		expect(demoted(context)).toStrictEqual({ rules: [] })
	})

	it('says so for a rule that is not demoted', async () => {
		expect(await printed(['--restore', 'firm'], context_of())).toBe(`${PREFIX} firm is not demoted`)
	})

	it.each([[['--period', '7', '--apply']], [['--restore', 'noisy', '--period', '7']]])(
		'refuses %j with its usage',
		async (argv) => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

			expect(await hook_ledger_cli.run(argv, context_of())).toBe(1)
			expect(error).toHaveBeenCalledWith(
				expect.stringContaining('[--demote [--apply]] | --restore <rule>'),
			)
		},
	)
})
