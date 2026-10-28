import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'
import { run_cut_report } from './run-cut-report'
import { run_cut_resume } from './run-cut-resume'

// joshuafolkken/kit#1839: a fresh process asks whether it resumes a cut, with the git reads spied, so
// what runs for real is the record logic — a matching tree resumes once and a clean one is refused.

const { ISSUE, BRANCH, CONTEXT_UNDER, target, state, session_verdict, verdict, existing_cut } =
	run_cut_cli_fixture

run_cut_cli_fixture.install()

async function resume(): Promise<number> {
	return await run_cut_resume.resume(target(), ISSUE)
}

describe('a fresh process checking whether to resume', () => {
	it('reports fresh when nothing was cut', async () => {
		const code = await resume()

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_report.FRESH_VERDICT)
	})

	// joshuafolkken/kit#1935: the first resume adopts and spends the hand-off; a second resume — a
	// process woken after its own cut — reads `is_handed_off: false` and is answered `handed-off`, a
	// benign stop, so it does nothing rather than investigating a tree that is not wrong.
	it('resumes a declared cut once, then answers a second resume handed-off', async () => {
		existing_cut()

		const first = await resume()
		const first_verdict = verdict()
		const second = await resume()

		expect(first).toBe(0)
		expect(first_verdict).toBe(run_cut_report.RESUME_VERDICT)
		expect(second).toBe(0)
		expect(verdict()).toBe(run_cut_report.HANDED_OFF_VERDICT)
	})

	it('refuses to resume when the tree is clean', async () => {
		existing_cut()
		state.mockResolvedValue({ branch: BRANCH, is_dirty: false, is_held: true })

		const code = await resume()

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_report.STALE_VERDICT)
	})

	it('resumes into implementation, not the gate, on a matching tree', async () => {
		existing_cut(run_cut.IMPLEMENTATION_PHASE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		const code = await resume()

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_report.RESUME_IMPL_VERDICT)
	})
})

// joshuafolkken/kit#2310: an implementation resume **removes** the record rather than marking it handed
// off, so both the implementation guard and the pre-gate guard re-arm — the whole point, since a
// lingering record kept them silent for the rest of the run and re-created the "fired 0 times" state.
// These are the tests that tell the two contracts apart: a record read only "between a cut and its
// resume" is gone here, where a record read "forever" would still be carried.
describe('re-arming after an implementation resume', () => {
	it('clears the record on an implementation resume so both guards re-arm', async () => {
		existing_cut(run_cut.IMPLEMENTATION_PHASE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		const code = await resume()

		expect([code, verdict()]).toStrictEqual([0, run_cut_report.RESUME_IMPL_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	// With the record cleared, a second resume finds nothing to adopt — `fresh`, not the `handed-off` a
	// pre-gate cut answers, because the pre-gate record survives to catch a double resume and this one
	// does not need to.
	it('answers a second implementation resume fresh, not handed-off', async () => {
		existing_cut(run_cut.IMPLEMENTATION_PHASE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)
		await resume()

		const second = await resume()

		expect([second, verdict()]).toStrictEqual([0, run_cut_report.FRESH_VERDICT])
	})

	// And the lane can take another cut when a long implementation re-crosses the threshold: the record
	// the first cut wrote is gone, so `begin_cut`'s exclusive create succeeds again rather than reporting
	// the tree busy.
	it('takes another implementation cut after a resume cleared the first', async () => {
		existing_cut(run_cut.IMPLEMENTATION_PHASE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)
		await resume()

		const again = await run_cut_cli.run(['--impl', ...run_cut_cli_fixture.WITH_HANDOFF, ISSUE])

		expect([again, verdict()]).toStrictEqual([0, run_cut_report.CUT_VERDICT])
	})
})
