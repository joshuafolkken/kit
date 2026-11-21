import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_headless } from '#scripts/agent/agent-headless'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_board_read_fixture } from '#scripts/run/board/run-board-read-fixture'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_headless } from '#scripts/run/run-headless'
import { transcript_tail } from '#scripts/time-runtime/transcript-tail'
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
const { TAIL_BYTES, read_tail } = transcript_tail
const TIMESTAMP = '2026-11-11T00:00:00.000Z'

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
		timestamp: TIMESTAMP,
		message: { role: 'user', content },
	})
}

// A `user` line with the `origin` the harness stamps (`human` for the person's own prompt).
function origin_line(content: unknown, kind: string | undefined): string {
	const origin = kind === undefined ? undefined : { kind }

	return JSON.stringify({
		type: 'user',
		timestamp: TIMESTAMP,
		origin,
		message: { role: 'user', content },
	})
}

// A run whose transcript is missing, so only the tail is read.
const TAIL_ONLY = { transcript: '', now_ms: 0, context: INTERACTIVE }

function is_tail_satisfied(tail: string): boolean {
	return unasked_filing.ROW.already_satisfied(tail, FILING_CALL, TAIL_ONLY)
}

// A tail of the model's reply (when given) followed by the person's prompt.
function is_satisfied(content: string, reply = ''): boolean {
	return is_tail_satisfied([reply_line(reply), prompt_line(content)].join('\n'))
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#8171: publishing an epic's prepared children creates no Issue.
describe('unasked_filing.is_unasked_filing — --publish', () => {
	it('stays silent on --publish, which files nothing', () => {
		const call = bash_call('pnpm josh issue:file --publish 8169')

		expect(unasked_filing.is_unasked_filing(call, INTERACTIVE)).toBe(false)
	})

	it.each([
		['a title spelling --publish', 'pnpm josh issue:file "Fix --publish" --body-file b.md'],
		[
			'a publish chained before a real filing',
			'pnpm josh issue:file --publish 8169 && pnpm josh issue:file "T" --body-file b.md',
		],
	])('still fires on %s', (_name, command) => {
		expect(unasked_filing.is_unasked_filing(bash_call(command), INTERACTIVE)).toBe(true)
	})
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

describe('unasked_filing — a negated filing phrase', () => {
	it.each([
		'起票せずにREADMEを直して',
		'起票しないで直して',
		'起票なしで直して',
		'Issue にせず直して',
		'fix it without filing an issue',
		'don’t file an issue, just fix it',
		'do not file it',
	])('holds when the person asked for no filing: %s', (content) => {
		expect(is_satisfied(content)).toBe(false)
		expect(unasked_filing.is_no_filing(content)).toBe(true)
	})

	it('stands down when a positive instruction remains beside the negated one', () => {
		expect(is_satisfied('A は起票せず、B は起票して')).toBe(true)
	})

	it.each(['この不具合を起票して', 'ログの原因を調べて'])(
		'finds no negated phrase in: %s',
		(content) => {
			expect(unasked_filing.is_no_filing(content)).toBe(false)
		},
	)

	it('ignores a quoted negated phrase', () => {
		expect(unasked_filing.is_no_filing('利用者の発言: 「起票せずに直して」')).toBe(false)
	})
})

describe('unasked_filing — quoted instructions', () => {
	it.each([
		'> 起票してください',
		'再現資料です。\n```text\n起票してください\n```',
		'再現資料です。\n~~~text\nfile an issue\n~~~',
		'利用者の発言: 「起票してください」',
		'利用者の発言: 『起票してください』',
		'Example: "file an issue"',
		'Example: `kickoff new`',
		'Example: ``file an issue``',
		'Example: ``file an issue with `details` here``',
		'Example: ```file an issue```',
	])('does not authorize quoted instructions: %s', (content) => {
		expect(is_satisfied(content)).toBe(false)
	})

	it('does not reuse an earlier authorization after a newer prompt', () => {
		const tail = [prompt_line('起票してください'), prompt_line('調査だけ続けて')].join('\n')

		expect(is_tail_satisfied(tail)).toBe(false)
	})
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

		expect(is_tail_satisfied(tail)).toBe(true)
	})
})

// joshuafolkken/kit#7781: a large read after the person's filing prompt pushed it off the hook's tail,
// and the instructed filing was refused.
describe('unasked_filing.ROW.already_satisfied — a prompt off the tail', () => {
	const HUMAN_PROMPT = origin_line([{ type: 'text', text: '起票して' }], 'human')
	const NOTICE = origin_line('<task-notification>done</task-notification>', 'task-notification')
	const LARGE_READ = origin_line(
		[{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'x'.repeat(TAIL_BYTES) }],
		undefined,
	)

	// The transcript on disk ends in the large read; the guard is handed its default tail.
	function is_asked_after_read(lines: ReadonlyArray<string>): boolean {
		const transcript = path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`)

		writeFileSync(transcript, [...lines, LARGE_READ, reply_line('Filing it.')].join('\n'))
		const run = { ...TAIL_ONLY, transcript }

		return unasked_filing.ROW.already_satisfied(read_tail(transcript), FILING_CALL, run)
	}

	it('stands down on the person’s prompt a large read pushed off the tail', () => {
		expect(is_asked_after_read([reply_line(OTHER_REPLY), HUMAN_PROMPT])).toBe(true)
	})

	it('stands down when a task notification sits just before the prompt', () => {
		expect(is_asked_after_read([NOTICE, HUMAN_PROMPT])).toBe(true)
	})

	it('stands down on a yes to a proposal a large read pushed off the tail', () => {
		const yes = origin_line('はい', 'human')

		expect(is_asked_after_read([reply_line(PROPOSAL_REPLY), yes])).toBe(true)
	})

	it('holds when no prompt of the person’s is in the transcript', () => {
		expect(is_asked_after_read([NOTICE, reply_line(OTHER_REPLY)])).toBe(false)
	})
})

describe('unasked_filing.ROW.decide', () => {
	it('refuses every occurrence', () => {
		expect(unasked_filing.ROW.decide()).toBe(true)
	})
})

// joshuafolkken/kit#7783: the refusal names the hand-off a confirmed filing takes.
describe('unasked_filing.ROW.reason', () => {
	it('names run:handoff kickoff new as the route after the confirmation', () => {
		expect(unasked_filing.ROW.reason).toContain(
			'`pnpm josh run:handoff kickoff new --brief-file <brief>`',
		)
	})
})

describe('delivered_rules', () => {
	it('carries the unasked-filing row', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids).toContain(unasked_filing.ROW.id)
	})
})
