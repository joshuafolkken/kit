import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_demoted } from './hook-demoted'
import { hook_ledger } from './hook-ledger'

// joshuafolkken/kit#6591: a demoted rule's refusal comes back as a notice and the call runs, while a
// rule not demoted still blocks. A separate suite from `pretool-guard.test.ts`, which is at its length
// limit.

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: {
		current_state: vi.fn(),
		parent_cut_reason: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

const { pretool_guard } = await import('./pretool-guard')
const { run_parent_cut_hook } = await import('#scripts/run/run-parent-cut-hook')

const TRANSCRIPT = path.join(
	temporary_directory('suite')('pretool-guard-demoted-'),
	'session.jsonl',
)
const ISSUE_READ = 'direct issue read'
const BATCH = '⛔ batch: one call per turn'
const SCOPE = '⛔ scope: outside the plan'
const CUT = '⛔ parent cut: hand the run off'

writeFileSync(TRANSCRIPT, '')

afterEach(() => {
	vi.restoreAllMocks()
})

function refusal(reason: string): GuardOutcome {
	return { reason, notice: undefined, fault: undefined }
}

// The envelope the hook writes and the reasons it hands the ledger for `gh issue view 7 --comments`,
// a read `direct-issue-read` refuses rather than rewrites.
async function responded(demoted: ReadonlyArray<string>): Promise<[string, Array<unknown>]> {
	vi.spyOn(hook_demoted, 'rules').mockReturnValue(new Set(demoted))
	const record = vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const payload = { tool_name: 'Bash', tool_input: { command: 'gh issue view 7 --comments' } }

	await pretool_guard.respond(JSON.stringify({ ...payload, transcript_path: TRANSCRIPT }))

	return [String(write.mock.calls[0]?.[0]), record.mock.calls.map((call) => call[1])]
}

describe('pretool_guard.respond — a demoted rule', () => {
	it('returns its refusal as a notice and lets the call run, still recording the refusal', async () => {
		const [envelope, recorded] = await responded([ISSUE_READ])

		expect(envelope).not.toContain('"deny"')
		expect(envelope).toContain('this call ran; do not reissue it')
		expect(envelope).toContain(`⛔ ${ISSUE_READ}`)
		expect(recorded).toEqual([expect.stringContaining(`⛔ ${ISSUE_READ}`)])
	})

	it('still asks the asynchronous guards, whose refusal blocks the call', async () => {
		vi.mocked(run_parent_cut_hook.parent_cut_reason).mockResolvedValueOnce(CUT)

		const [envelope] = await responded([ISSUE_READ])

		expect(envelope).toContain('"deny"')
		expect(envelope).toContain(CUT)
	})

	it('still blocks a rule that is not demoted', async () => {
		const [envelope, recorded] = await responded(['batch'])

		expect(envelope).toContain('"deny"')
		expect(envelope).toContain(`⛔ ${ISSUE_READ}`)
		expect(recorded).toEqual([expect.stringContaining(`⛔ ${ISSUE_READ}`)])
	})
})

describe('pretool_guard.combine_outcomes — demoted rules', () => {
	it('lets a refusal from a rule not demoted win over a demoted one', () => {
		const outcome = pretool_guard.combine_outcomes(
			[refusal(BATCH), refusal(SCOPE)],
			undefined,
			new Set(['batch']),
		)

		expect(outcome).toStrictEqual(refusal(SCOPE))
	})

	it('turns the first demoted refusal into a notice when every refusal is demoted', () => {
		const outcome = pretool_guard.combine_outcomes(
			[refusal(BATCH)],
			SCOPE,
			new Set(['batch', 'scope']),
		)

		expect(outcome).toStrictEqual({
			reason: undefined,
			notice: `${hook_demoted.NOTICE_HEADER}${BATCH}`,
			fault: undefined,
		})
	})

	it('keeps blocking when nothing is demoted', () => {
		expect(pretool_guard.combine_outcomes([refusal(BATCH)], undefined, new Set())).toStrictEqual(
			refusal(BATCH),
		)
	})
})
