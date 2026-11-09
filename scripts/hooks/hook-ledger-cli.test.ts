import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_ledger_cli, type LedgerContext } from './hook-ledger-cli'
import type { InterruptIssue } from './hook-ledger-issues'

// joshuafolkken/kit#6664: `josh hook:ledger --period 7` prints one row per hook and rule from the
// ledger's jsonl — its refusals, those the same session's same call later went through, and the
// `route:interrupt` Issues naming the rule, `unknown` when that listing could not be read.

const make_directory = temporary_directory('suite')
const NOW = new Date('2026-11-09T12:00:00.000Z')
const DAY = '2026-11-09'
const GUARD = 'pretool:guard'
const COMMAND = 'git push'
const PATTERN = 'needle'
const BASH = 'Bash'
const GREP = 'Grep'
const REFUSED_AT = '2026-11-09T10:00:00.000Z'
const LEDGER_AT = '2026-11-09T10:00:01.000Z'
const PASSED_AT = '2026-11-09T10:05:00.000Z'

afterEach(() => {
	vi.restoreAllMocks()
})

function use_line(id: string, at: string, tool = BASH): string {
	const input = tool === BASH ? { command: COMMAND } : { pattern: PATTERN }
	const block = { type: 'tool_use', id, name: tool, input }

	return JSON.stringify({ type: 'assistant', timestamp: at, message: { content: [block] } })
}

function result_line(id: string, at: string, is_error: boolean): string {
	const block = { type: 'tool_result', tool_use_id: id, content: '', is_error }

	return JSON.stringify({ type: 'user', timestamp: at, message: { content: [block] } })
}

// A tool's call refused, then the same call going through.
function refused_then_passed(tool: string): Array<string> {
	return [
		use_line(`${tool}-refused`, REFUSED_AT, tool),
		result_line(`${tool}-refused`, REFUSED_AT, true),
		use_line(`${tool}-again`, PASSED_AT, tool),
		result_line(`${tool}-again`, PASSED_AT, false),
	]
}

// A transcript where a Bash and a Grep call were refused, and then the same calls went through.
function transcript(root: string): string {
	const file = path.join(root, 'session.jsonl')
	const lines = [...refused_then_passed(BASH), ...refused_then_passed(GREP)]

	writeFileSync(file, lines.join('\n'))

	return file
}

function ledger_line(rule: string, session: string, tool = BASH): string {
	const entry = {
		at: LEDGER_AT,
		hook: GUARD,
		rule,
		tool,
		role: '',
		session,
		command: tool === BASH ? COMMAND : PATTERN,
	}

	return JSON.stringify(entry)
}

function context_of(issues: ReadonlyArray<InterruptIssue> | undefined): LedgerContext {
	const root = make_directory('hook-ledger-cli-test-')
	const directory = path.join(root, 'ledger')
	const session = transcript(root)
	const lines = [
		ledger_line('batch', session),
		ledger_line('batch', ''),
		ledger_line('investigation', session, GREP),
		ledger_line('scope', ''),
	]

	mkdirSync(directory)
	writeFileSync(path.join(directory, `${DAY}.jsonl`), `${lines.join('\n')}\n`)

	return {
		directory,
		now: NOW,
		read_issues: async () => await issues,
		demoted_file: path.join(root, 'hook-demoted.json'),
	}
}

async function printed(argv: ReadonlyArray<string>, context: LedgerContext): Promise<string> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

	expect(await hook_ledger_cli.run(argv, context)).toBe(0)

	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('hook_ledger_cli.run — the table', () => {
	it('prints refusals, later passes and interrupt issues per rule for --period 7', async () => {
		const issues = [{ body: 'the `batch` rule refused', createdAt: REFUSED_AT }]
		const output = await printed(['--period', '7'], context_of(issues))

		expect(output.split('\n')).toStrictEqual([
			'| hook | rule | refusals | passed later | interrupts |',
			'| --- | --- | --- | --- | --- |',
			`| ${GUARD} | batch | 2 | 1 | 1 |`,
			`| ${GUARD} | investigation | 1 | 1 | 0 |`,
			`| ${GUARD} | scope | 1 | 0 | 0 |`,
		])
	})

	it('prints unknown interrupts when the issue listing could not be read', async () => {
		const output = await printed(['--period', '7'], context_of(undefined))

		expect(output).toContain(`| ${GUARD} | scope | 1 | 0 | unknown |`)
	})

	it('says so when the period holds no refusals', async () => {
		const context = { ...context_of([]), now: new Date('2026-12-31T00:00:00.000Z') }

		expect(await printed(['--period', '1'], context)).toContain('no refusals in the last 1 day(s)')
	})
})

describe('hook_ledger_cli.run — refusals', () => {
	it.each([[[]], [['--period', '0']], [['--period', 'week']], [['--period', '7', 'extra']]])(
		'refuses %j with its usage',
		async (argv) => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

			expect(await hook_ledger_cli.run(argv, context_of([]))).toBe(1)
			expect(error).toHaveBeenCalledWith(hook_ledger_cli.USAGE)
		},
	)
})
