import { time_line_fixture } from '#tools/time/time-line-fixture'
import { describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_digest, type SessionDigest } from './run-cut-digest'
import type { Handoff } from './run-cut-handoff'

// joshuafolkken/kit#5040: a resumed lane child spent minutes re-reading what the cut session had
// already read. These pin the digest the cut derives from its own transcript and prints on resume.

const ROOT = '/lanes/5040'
const FILE_A = 'scripts/a.ts'
const DECISION = `${run_cut_digest.DECISION_PREFIX} \`derive\` over \`handoff keys\` because the reason is at its bound`
const POSTED = `${run_cut_digest.DECISION_PREFIX} \`posted\` over \`replied\` because a lane works an Issue`
const WRITTEN = `${run_cut_digest.DECISION_PREFIX} \`body file\` over \`inline\` because it is long`
const HANDOFF: Handoff = { instruction: 'go', completed: [], remaining: [], untouched: [] }
const SPEC = { issue: '5040', branch: '5040-lane', phase: run_cut.IMPLEMENTATION_PHASE }

function read_call(minute: number, id: string, file: string): string {
	return time_line_fixture.tool_use(minute, 'Read', id, { file_path: file })
}

function said(minute: number, text: string): string {
	return JSON.stringify({
		type: time_line_fixture.ASSISTANT_LINE,
		timestamp: time_line_fixture.at(minute),
		message: { content: [{ type: 'text', text }] },
	})
}

const TRANSCRIPT = [
	read_call(0, 'a', `${ROOT}/${FILE_A}`),
	time_line_fixture.tool_result(1, 'a', false),
	read_call(2, 'b', `${ROOT}/scripts/b.ts`),
	time_line_fixture.tool_result(3, 'b', true),
	read_call(4, 'c', `${ROOT}/scripts/c.ts`),
	time_line_fixture.tool_result(5, 'c', false),
	read_call(6, 'd', `${ROOT}/${FILE_A}`),
	time_line_fixture.tool_result(7, 'd', false),
	said(8, `Working on it.\n${DECISION}\nNext.`),
	// An Issue workflow logs its decision in a comment a tool call posts; a source file spelling the bare
	// prefix is not a decision.
	time_line_fixture.tool_use(9, 'Bash', 'e', { command: `gh issue comment 5040 -b '${POSTED}'` }),
	time_line_fixture.tool_use(10, 'Write', 'f', { content: `x\n${WRITTEN}\n` }),
	time_line_fixture.tool_use(11, 'Write', 'g', { content: "const PREFIX = 'Auto-decided:'" }),
	time_line_fixture.tool_use(12, 'Edit', 'h', { new_string: `'${DECISION} in a test'` }),
].join('\n')

describe('digest_of', () => {
	const digest = run_cut_digest.digest_of(TRANSCRIPT, ROOT)

	it('lists each successful read once, relative to the checkout, newest last', () => {
		expect(digest.read).toEqual(['scripts/c.ts', FILE_A])
	})

	it('keeps the Auto-decided lines of its replies and of its posted comments', () => {
		expect(digest.decisions).toEqual([DECISION, POSTED, WRITTEN])
	})
})

describe('own_digest', () => {
	// The newest-file fallback could read another session filed under the checkout.
	it('reads nothing for a session that does not name itself', () => {
		expect(run_cut_digest.own_digest(ROOT, {})).toBeUndefined()
	})
})

describe('describe_digest', () => {
	it('prints both lists', () => {
		const printed = run_cut_digest.describe_digest({
			read: [FILE_A],
			decisions: [DECISION],
		})

		expect(printed).toContain(`  - ${FILE_A}`)
		expect(printed).toContain(`  - ${DECISION}`)
	})

	it('prints nothing for an absent or empty digest', () => {
		expect(run_cut_digest.describe_digest(undefined)).toBeUndefined()
		expect(run_cut_digest.describe_digest({ read: [], decisions: [] })).toBeUndefined()
	})
})

describe('with_digest', () => {
	const DIGEST: SessionDigest = { read: [FILE_A], decisions: [] }

	it('attaches the digest to an implementation cut', () => {
		expect(run_cut.with_digest({ ...SPEC, handoff: HANDOFF }, () => DIGEST).digest).toEqual(DIGEST)
	})

	it('never derives one for a pre-gate cut', () => {
		const derive = vi.fn(() => DIGEST)

		expect(run_cut.with_digest(SPEC, derive).digest).toBeUndefined()
		expect(derive).not.toHaveBeenCalled()
	})

	it('drops a digest the record bound cannot hold rather than refusing the cut', () => {
		const huge: SessionDigest = { read: ['x'.repeat(run_cut.MAX_HANDOFF_BYTES)], decisions: [] }
		const spec = run_cut.with_digest({ ...SPEC, handoff: HANDOFF }, () => huge)

		expect(spec.digest).toBeUndefined()
		expect(run_cut.record_within_bound(spec)).toBe(true)
	})
})
