import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { observation_ledger } from '#scripts/observations/observation-ledger'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { review_prior_findings } from './review-prior-findings'
import { review_record_cli } from './review-record-cli'
import type { review_stop_log } from './review-stop-log'

// joshuafolkken/kit#4817: a finding an agent records with its reason reaches the lane's next stop fix
// and next review prompt, through the stop log `review-prior-findings.ts` reads.

// A test run's stop log writes nothing without a path, so the record is pointed at this one.
const log_target = vi.hoisted(() => ({ path: '' }))

vi.mock('./review-stop-log', async (original) => {
	const actual = await original<{ review_stop_log: typeof review_stop_log }>()

	return {
		review_stop_log: {
			...actual.review_stop_log,
			record: (stop: Parameters<typeof actual.review_stop_log.record>[0]) => {
				actual.review_stop_log.record(stop, log_target.path)
			},
		},
	}
})

const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'review-record-reasons-'))
const LOG = path.join(TEST_DIR, 'review-stops.jsonl')

log_target.path = LOG

vi.mock('./review-comment-round', () => ({
	review_comment_round: { carry: vi.fn().mockResolvedValue(0), body_of: vi.fn(() => '') },
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: vi.fn().mockRejectedValue(new Error('gh refused')) },
}))

// The real record would retake this checkout's reviewed-tree stamp, which a running lane reads.
vi.mock('./review-reviewed-tree', () => ({ review_reviewed_tree: { record: vi.fn() } }))

vi.mock('./review-round-reuse', () => ({
	review_round_reuse: {
		is_reusable: vi.fn().mockResolvedValue(false),
		is_stale_here: vi.fn().mockResolvedValue(false),
	},
}))

// The real probe reads this checkout's branch; `review-record-cli-push.test.ts` owns the pushed case.
vi.mock('#scripts/run/ship/run-ship-probe', () => ({
	run_ship_probe: { is_pushed_clean: vi.fn().mockResolvedValue(false) },
}))

const NOW = new Date('2026-10-25T00:00:00Z')
const ISSUE = 4772
const EPERM_SPEC = 'bug-risks:medium:tick.ts:187'
const EPERM_REASON = 'is_live_pid reads EPERM as dead. A second sentence is not kept.'
const EPERM_ENTRY =
	'tick.ts:187 — is_live_pid reads EPERM as dead. (bug-risks:medium, fixed in place in the review:record stage)'

afterAll(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

async function quietly(run: () => Promise<number>): Promise<number> {
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
	const code = await run()

	info.mockRestore()
	error.mockRestore()

	return code
}

function ledger_of(root: string): string {
	return readFileSync(path.join(root, observation_ledger.ledger_file(ISSUE)), 'utf8')
}

async function record(name: string, positionals: ReadonlyArray<string>): Promise<string> {
	const root = path.join(TEST_DIR, name)
	const argv = ['--issue', String(ISSUE), ...positionals]
	const code = await quietly(async () => await review_record_cli.run(argv, NOW, root))

	expect(code).toBe(0)

	return root
}

describe('review_record_cli.run with a reason', () => {
	it('carries the location and reason into the next stop fix and the next review prompt', async () => {
		await record('with-reason', [`${EPERM_SPEC} — ${EPERM_REASON}`])

		const current = [{ kind: 'performance:medium', location: 'tick.ts:190', sentence: 'slow.' }]
		const fix = review_prior_findings.fix_lines(
			review_prior_findings.on_files(String(ISSUE), current, LOG),
		)

		expect(fix).toContain(`- ${EPERM_ENTRY}`)
		expect(review_prior_findings.prompt_clauses(String(ISSUE), LOG)[0]).toContain(EPERM_ENTRY)
	})

	it('keeps the ledger line to the spec alone, as a finding without a reason writes it', async () => {
		const root = await record('ledger-spec', [`${EPERM_SPEC} - ${EPERM_REASON}`])

		expect(ledger_of(root)).toBe(
			'- rb:2026-10-25 | #4772\n- rf:bug-risks | medium | tick.ts:187 | 2026-10-25 | #4772\n',
		)
	})
})

describe('review_record_cli.run without a reason', () => {
	it('writes the same ledger line as before and nothing to the stop log', async () => {
		rmSync(LOG, { force: true })

		const root = await record('no-reason', [EPERM_SPEC, 'tests:low:a.test.ts'])

		expect(ledger_of(root)).toBe(
			'- rb:2026-10-25 | #4772\n- rf:bug-risks | medium | tick.ts:187 | 2026-10-25 | #4772\n- rf:tests | low | a.test.ts | 2026-10-25 | #4772\n',
		)
		expect(existsSync(LOG)).toBe(false)
	})
})

describe('review_record_cli.run with --comment that cannot be posted', () => {
	it('fails the record and writes no reason to the stop log', async () => {
		rmSync(LOG, { force: true })

		const root = path.join(TEST_DIR, 'comment-refused')
		const argv = ['--issue', String(ISSUE), '--comment', `${EPERM_SPEC} — ${EPERM_REASON}`]
		const code = await quietly(async () => await review_record_cli.run(argv, NOW, root))

		expect(code).not.toBe(0)
		expect(existsSync(LOG)).toBe(false)
	})
})
