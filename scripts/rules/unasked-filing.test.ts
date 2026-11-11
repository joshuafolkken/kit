import { agent_headless } from '#scripts/agent/agent-headless'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_board_read_fixture } from '#scripts/run/board/run-board-read-fixture'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_headless } from '#scripts/run/run-headless'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { unasked_filing } from './unasked-filing'

// joshuafolkken/kit#7293: a consultation session filed an Issue the person never asked for. The row
// refuses an interactive `issue:file` unless the person's last prompt asks for filing, and stays silent
// for every unattended run.

const FILING_CALL = {
	name: 'Bash',
	input: { command: 'pnpm josh issue:file "Title" --body-file b.md' },
}
const CHECK_CALL = { name: 'Bash', input: { command: 'pnpm josh issue:file "Title" --check' } }
const make_directory = temporary_directory('suite')
const WORK_DIRECTORY = make_directory('unasked-filing-')
const INTERACTIVE = hook_context_fixture.of(WORK_DIRECTORY, {})

const OWNER_PID = 4242

const PROPOSAL_REPLY = 'この不具合を Issue として起票しますか？'
const OTHER_REPLY = 'テストを追加しました。続けますか？'

function bash_call(command: string): { name: string; input: { command: string } } {
	return { name: 'Bash', input: { command } }
}

function reply_line(text: string): string {
	return JSON.stringify({
		type: 'assistant',
		message: { role: 'assistant', content: [{ type: 'text', text }] },
	})
}

function prompt_line(content: string, is_meta = false): string {
	return JSON.stringify({
		type: 'user',
		isMeta: is_meta,
		timestamp: '2026-11-11T00:00:00.000Z',
		message: { role: 'user', content },
	})
}

// A tail of the model's reply (when given) followed by the person's prompt.
function is_satisfied(content: string, reply = ''): boolean {
	return unasked_filing.ROW.already_satisfied([reply_line(reply), prompt_line(content)].join('\n'))
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('unasked_filing.is_unasked_filing', () => {
	it('fires on an interactive session’s issue:file', () => {
		expect(unasked_filing.is_unasked_filing(FILING_CALL, INTERACTIVE)).toBe(true)
	})

	it('stays silent on --check, which files nothing', () => {
		expect(unasked_filing.is_unasked_filing(CHECK_CALL, INTERACTIVE)).toBe(false)
	})

	it.each([
		['a title spelling --check', 'pnpm josh issue:file "Drop --check flag" --body-file b.md'],
		[
			'a checked filing chained before a real one',
			'pnpm josh issue:file "T" --check && pnpm josh issue:file "T" --body-file b.md',
		],
	])('fires on %s', (_name, command) => {
		expect(unasked_filing.is_unasked_filing(bash_call(command), INTERACTIVE)).toBe(true)
	})

	it.each([
		['a kit-launched headless session', agent_headless.environment()],
		['the headless backlogrun parent', run_headless.environment()],
		['a dispatched lane child', lane_child_marker.env_for('7293')],
	])('stays silent in %s', (_name, environment) => {
		const context = hook_context_fixture.of(WORK_DIRECTORY, environment)

		expect(unasked_filing.is_unasked_filing(FILING_CALL, context)).toBe(false)
	})

	it('stays silent in the session that drives a live backlogrun', () => {
		const carry = { ...run_board_read_fixture.CARRY, owner_pid: OWNER_PID }

		vi.spyOn(git_common_directory, 'repository').mockReturnValue(WORK_DIRECTORY)
		vi.spyOn(run_carry, 'read_carry').mockReturnValue({ kind: 'carried', carry })
		const owner = { ...INTERACTIVE, ancestry: (): ReadonlySet<number> => new Set([OWNER_PID]) }

		expect(unasked_filing.is_unasked_filing(FILING_CALL, owner)).toBe(false)
	})
})

describe('unasked_filing.ROW.already_satisfied', () => {
	it.each([
		'これを起票して',
		'Issue にして',
		'please file an issue for it',
		'kickoff new',
		'/fullrun #12',
		'halfrun new',
		'prrun new',
	])('stands down when the person asked: %s', (content) => {
		expect(is_satisfied(content)).toBe(true)
	})

	it.each(['リリース不具合の原因を調べて', 'read the file and explain', ''])(
		'holds when the person did not ask: %s',
		(content) => {
			expect(is_satisfied(content)).toBe(false)
		},
	)
})

describe('unasked_filing.ROW.already_satisfied — a yes to a proposal', () => {
	it.each(['はい', 'お願いします', 'yes', 'OK'])(
		'stands down on a yes to a proposed Issue: %s',
		(content) => {
			expect(is_satisfied(content, PROPOSAL_REPLY)).toBe(true)
		},
	)

	it.each([OTHER_REPLY, 'No issues found; shall I commit?', '起票は不要です。続けますか？'])(
		'holds on a yes to a reply that proposes no Issue: %s',
		(reply) => {
			expect(is_satisfied('ok', reply)).toBe(false)
		},
	)

	it('anchors on the person’s yes, past a skill body the harness wrote after it', () => {
		const tail = [
			reply_line(PROPOSAL_REPLY),
			prompt_line('はい'),
			reply_line('Loading the skill.'),
			prompt_line('skill body', true),
		].join('\n')

		expect(unasked_filing.ROW.already_satisfied(tail)).toBe(true)
	})
})

describe('unasked_filing.ROW.decide', () => {
	it('refuses every occurrence', () => {
		expect(unasked_filing.ROW.decide()).toBe(true)
	})
})

describe('delivered_rules', () => {
	it('carries the unasked-filing row', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids).toContain(unasked_filing.ROW.id)
	})
})
