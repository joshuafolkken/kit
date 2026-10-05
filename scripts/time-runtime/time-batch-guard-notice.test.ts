import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { time_batch_guard } from './time-batch-guard'
import { EDIT_TOOL, transcript } from './time-batch-guard-fixtures'

// The concrete half of the batching notice: the recent single-call turns it names, and — since
// joshuafolkken/kit#2311 — the one `read:files` call that folds them where they were reads. Split out
// of `time-batch-guard.test.ts` so that suite stays under its line limit; the shared calls and the
// `transcript` builder come from `time-batch-guard-fixtures.ts`, the fixture turn-line helpers from the
// transcript fixture. The minute grid is the fixture's: turn `n` issues on minute `2n + 1`.

const { open_turn_lines, target_turn_lines } = time_transcript_fixture

// joshuafolkken/kit#2311. Naming the calls did not move the density (#2276) — the notice still asked
// the model to reissue them in one turn, the parallel-block request it resists. The lever measured to
// work is a composite command that folds the reads into one call, so the notice now hands the model
// that call ready to paste — but only over reads, and only where two or more could fold.
const FOLD_COMMAND = 'pnpm josh read:files'
// The write-side counterpart the guard hands a run of single-call edits (joshuafolkken/kit#2366).
const EDIT_FOLD_COMMAND = 'pnpm josh edit:files'

// A run of single-call edits, the shape the edit fold names. Reused by the read suite (it earns no
// `read:files` command) and the edit suite (it earns the `edit:files` one).
const EDIT_RUN: Array<Array<string>> = [
	target_turn_lines(0, ['a.ts'], EDIT_TOOL),
	target_turn_lines(1, ['b.ts'], EDIT_TOOL),
	open_turn_lines(2, ['c.ts'], EDIT_TOOL),
]

// The runs that name their candidates but earn no read fold command: a lone read is a single call
// already, `read:files` folds reads (never edits, which fold via `edit:files` instead), and a directory
// (`ls scripts/` names a directory `read:files` cannot read) must never reach the paste-ready command.
// Lifted out of the suite so its callback stays under the test line limit.
const NO_FOLD_CASES: Array<[string, Array<Array<string>>]> = [
	['a lone read', [target_turn_lines(0, ['a.ts']), open_turn_lines(1, ['c.ts'])]],
	['a run of edits', EDIT_RUN],
	[
		'a run of directory reads',
		[
			target_turn_lines(0, ['scripts/']),
			target_turn_lines(1, ['prompts/']),
			open_turn_lines(2, ['c.ts']),
		],
	],
]

describe('time_batch_guard.recent_candidates', () => {
	it('names the recent single-call reads and offers the read:files call that folds them', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['b.ts']),
			open_turn_lines(2, ['c.ts']),
		)

		expect(time_batch_guard.recent_candidates(text)).toContain('Read a.ts')
		expect(time_batch_guard.recent_candidates(text)).toContain(`${FOLD_COMMAND} a.ts b.ts`)
		expect(time_batch_guard.recent_candidates('')).toBe('')
	})

	it.each(NO_FOLD_CASES)('offers no read fold command over %s', (_label, groups) => {
		expect(time_batch_guard.recent_candidates(transcript(...groups))).not.toContain(FOLD_COMMAND)
	})

	// A directory read mixed in with file reads is dropped from the fold, never from the naming: the
	// directory is still named as a turn that could have shared one, but the fold command lists only the
	// files — so the exact command is `read:files a.ts b.ts` with `scripts/` nowhere between them.
	it('folds only the file targets and never the directory among them', () => {
		const text = transcript(
			target_turn_lines(0, ['a.ts']),
			target_turn_lines(1, ['scripts/']),
			target_turn_lines(2, ['b.ts']),
			open_turn_lines(3, ['c.ts']),
		)

		expect(time_batch_guard.recent_candidates(text)).toContain(`${FOLD_COMMAND} a.ts b.ts`)
	})
})

// The write-side fold (joshuafolkken/kit#2366): a run of single-call edits names the edits and hands the
// `edit:files` call over their files, the counterpart of the read fold. A single edit folds nothing, and
// a run of edits never reaches for the read command.
describe('time_batch_guard.recent_candidates — the write-side fold', () => {
	it('names the recent single-call edits and offers the edit:files fold over them', () => {
		const tail = time_batch_guard.recent_candidates(transcript(...EDIT_RUN))

		expect(tail).toContain('Edit a.ts')
		expect(tail).toContain(EDIT_FOLD_COMMAND)
		expect(tail).toContain('a.ts b.ts')
		expect(tail).not.toContain(FOLD_COMMAND)
	})

	it('offers no edit fold over a lone edit', () => {
		const lone = [
			target_turn_lines(0, ['a.ts'], EDIT_TOOL),
			open_turn_lines(1, ['c.ts'], EDIT_TOOL),
		]

		expect(time_batch_guard.recent_candidates(transcript(...lone))).not.toContain(EDIT_FOLD_COMMAND)
	})
})

// joshuafolkken/kit#3157: the candidates the live density line names for a call that has already run.
// The call is named after the closed turns behind it, and a call sharing a target with them names nothing.
const CLOSED_READS_LINES = [
	target_turn_lines(0, ['a.ts']),
	target_turn_lines(1, ['b.ts']),
	target_turn_lines(2, ['c.ts']),
]
const CLOSED_READS = transcript(...CLOSED_READS_LINES)

describe('time_batch_guard.pairing_candidates', () => {
	it('names the closed single-call reads beside the call in hand and folds them all', () => {
		const tail = time_batch_guard.pairing_candidates(CLOSED_READS, {
			name: 'Read',
			input: { file_path: 'd.ts' },
		})

		expect(tail).toContain('Read b.ts')
		expect(tail).toContain('Read d.ts')
		expect(tail).toContain(`${FOLD_COMMAND} a.ts b.ts d.ts`)
	})

	it('names nothing when the call in hand shares a target with the turns behind it', () => {
		const call = { name: EDIT_TOOL, input: { file_path: 'a.ts' } }

		expect(time_batch_guard.pairing_candidates(CLOSED_READS, call)).toBe('')
	})

	it('names nothing when no closed single-call turn stands behind the call', () => {
		const call = { name: 'Read', input: { file_path: 'd.ts' } }

		expect(time_batch_guard.pairing_candidates('', call)).toBe('')
	})

	// The shape a `PostToolUse` hook reads: the call in hand's own `tool_use` line is already written,
	// which closes the turn just before it — the dependency most often missed sits in that turn.
	it('names nothing when the call in hand edits what the turn just before it read', () => {
		const tail = transcript(...CLOSED_READS_LINES, open_turn_lines(3, ['c.ts'], EDIT_TOOL))
		const call = { name: EDIT_TOOL, input: { file_path: 'c.ts' } }

		expect(time_batch_guard.pairing_candidates(tail, call)).toBe('')
	})

	// A call that is not bundleable names no targets, so a verification run after a stretch of edits
	// would otherwise be offered beside the edits it reads.
	it('names nothing when the call in hand is not bundleable', () => {
		const call = { name: 'Bash', input: { command: 'pnpm install' } }

		expect(time_batch_guard.pairing_candidates(CLOSED_READS, call)).toBe('')
	})
})
