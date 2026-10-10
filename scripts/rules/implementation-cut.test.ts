import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import type { CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import type { RunCut } from '#scripts/run/cut/run-cut'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import { afterAll, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { implementation_cut, type LaneCostState } from './implementation-cut'

// joshuafolkken/kit#2310: the implementation-phase cut fired 0 times across five lanes while the
// verdict was read only at session entry, where the context has not yet grown. This suite owns the two
// halves that decide whether the refusal fires — the `Edit` / `Write` occasion in an uncut lane child,
// and the "is the recent-context cost over threshold" read. **Both directions matter**: a row that
// stays silent leaves the measured defect where it was, and one that speaks in an ordinary checkout
// refuses every edit a person makes.

const ISSUE = '2310'
const EDIT = 'Edit'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'implementation-cut-'))
const LANE_ROOT = path.join(WORK_DIRECTORY, '.kit-lanes')
const LANE_DIRECTORY = path.join(LANE_ROOT, ISSUE)
const OVER: CostVerdict = 'over'
const UNDER: CostVerdict = 'under'
const UNMEASURABLE: CostVerdict = 'unmeasurable'

const IMPLEMENTATION_CUT_ID = 'implementation-cut'
const TAKE_THE_IMPL_CUT = `pnpm josh run:cut --impl ${ISSUE}`
const BARE_CUT = `pnpm josh run:cut ${ISSUE}`
const RESUME_CHECK = `pnpm josh run:cut --resume ${ISSUE}`

function cut_of(issue: string): RunCut {
	return {
		invocation: `fullrun #${issue}`,
		issue,
		branch: `${issue}-lane`,
		phase: 'implementation',
		cut_at: new Date().toISOString(),
		is_handed_off: false,
	}
}

interface StateOptions {
	directory?: string
	mark?: string | undefined
	cut?: RunCut | undefined
	held?: string | undefined
	verdict?: () => CostVerdict
	// The role fragment the launch wrote, absent for a session kit did not launch.
	role?: MarkerSource
}

const REVIEWER = agent_session_role.env_for(agent_role_profile.REVIEWER)
const WORKER = agent_session_role.env_for(agent_role_profile.WORKER)

// `'mark' in options` rather than a destructuring default, so an explicit `{ mark: undefined }` — a
// person's lane with no dispatch mark — is honored instead of falling back to ISSUE.
function mark_of(options: StateOptions): string | undefined {
	return 'mark' in options ? options.mark : ISSUE
}

function source_of(mark: string | undefined): MarkerSource {
	return mark === undefined ? {} : { [lane_child_marker.KEY]: mark }
}

// The dispatched-child case the refusal exists for: the mark names this lane's own issue, read from an
// injected source so the suite never has to set the live environment. `verdict` is injected too, so a
// firing case needs no session transcript on disk.
function state_of(options: StateOptions = {}): LaneCostState {
	const { directory = LANE_DIRECTORY, cut, held, verdict = (): CostVerdict => OVER } = options

	return {
		directory,
		source: { ...source_of(mark_of(options)), ...options.role },
		carried: () => cut,
		held_issue: () => held,
		verdict,
	}
}

function edit_call(name = EDIT): { name: string; input: unknown } {
	return { name, input: { file_path: 'scripts/x.ts', old_string: 'a', new_string: 'b' } }
}

function run_at(now_ms: number): { transcript: string; now_ms: number } {
	return { transcript: path.join(WORK_DIRECTORY, 'transcript.jsonl'), now_ms }
}

// A verdict thunk that fails the test if it is ever read — used to prove the cost measurement is gated
// behind the cheap tool-name and lane reads, never run on a call this guard does not own.
function unread_verdict(): CostVerdict {
	throw new Error('the cost verdict was read for a call the guard does not own')
}

// The refusal asks for the handoff in the format the parser reads (joshuafolkken/kit#3195) — the
// prose-only list was answered with Markdown that `run:cut --impl --handoff` refused.
describe('the handoff format the refusal asks for', () => {
	it('states the JSON format the handoff parser reads', () => {
		expect(implementation_cut.IMPLEMENTATION_CUT_REASON).toContain(run_cut_handoff.HANDOFF_FORMAT)
	})

	// A refusal that named no place got the file written beside the code, where `josh git` staged it
	// with the commit (joshuafolkken/kit#3603).
	it('names the ignored path the handoff file is written at', () => {
		expect(implementation_cut.IMPLEMENTATION_CUT_REASON).toContain(run_cut_handoff.HANDOFF_PATH)
	})

	it.each(run_cut_handoff.handoff_schema.keyof().options)('names the schema key %j', (key) => {
		expect(implementation_cut.IMPLEMENTATION_CUT_REASON).toContain(`"${key}"`)
	})
})

describe('takes_the_impl_cut', () => {
	it.each([[TAKE_THE_IMPL_CUT], [`pnpm josh run:cut --impl=${ISSUE}`]])(
		'reads %j as taking the implementation cut',
		(command) => {
			expect(implementation_cut.takes_the_impl_cut(command)).toBe(true)
		},
	)

	// **The bare cut is the pre-gate boundary, and the asking spellings are not a cut.** A predicate that
	// counted a bare `run:cut` would credit the pre-gate cut as the implementation one.
	it.each([[BARE_CUT], [RESUME_CHECK], ['pnpm josh run:cut --end'], ['pnpm josh gate']])(
		'says nothing about %j',
		(command) => {
			expect(implementation_cut.takes_the_impl_cut(command)).toBe(false)
		},
	)
})

describe('uncut_run_issue', () => {
	it('names the issue for a marked lane child with no cut carried', () => {
		expect(implementation_cut.uncut_run_issue(state_of())).toBe(ISSUE)
	})

	// **The carried-cut half keeps the guard silent between a cut and its resume.**
	it('says nothing once a cut record for that issue is carried', () => {
		const state = state_of({ cut: cut_of(ISSUE) })

		expect(implementation_cut.uncut_run_issue(state)).toBeUndefined()
	})

	it('still names the issue when the carried record belongs to another one', () => {
		const state = state_of({ cut: cut_of('2294') })

		expect(implementation_cut.uncut_run_issue(state)).toBe(ISSUE)
	})

	// **A person working in the lane carries no dispatch mark**, so the rule stays silent for them.
	it('says nothing when the lane carries no dispatch mark', () => {
		expect(implementation_cut.uncut_run_issue(state_of({ mark: undefined }))).toBeUndefined()
	})

	// **A mark that leaked in from a parent session names some other issue.**
	it('says nothing when the dispatch mark names another issue', () => {
		expect(implementation_cut.uncut_run_issue(state_of({ mark: '2294' }))).toBeUndefined()
	})

	it.each([[LANE_ROOT], [WORK_DIRECTORY], [path.join(LANE_ROOT, 'main')]])(
		'says nothing about %j, which is not a lane checkout',
		(directory) => {
			expect(implementation_cut.uncut_run_issue(state_of({ directory }))).toBeUndefined()
		},
	)
})

describe('is_over_threshold_edit', () => {
	// **The firing case, and the acceptance condition #2310 pins**: an edit in a marked lane child whose
	// recent-context cost is over threshold.
	it.each([[EDIT], ['Write']])('fires on a %j in an over-threshold uncut lane child', (name) => {
		expect(implementation_cut.is_over_threshold_edit(edit_call(name), state_of())).toBe(true)
	})

	// **Below the threshold it does not fire** — the other half of the acceptance condition.
	it('says nothing when the recent-context cost is under threshold', () => {
		const state = state_of({ verdict: (): CostVerdict => UNDER })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	// **The unmeasurable direction matches the pre-gate cut** (joshuafolkken/kit#2385): a session that
	// cannot be priced warrants the cut as a safety net, the `verdict !== UNDER_VERDICT` reading
	// `pre-gate-cut.ts`'s `warrants_the_cut` takes, so the two rules never disagree about whether an
	// unmeasurable session is due a cut.
	it('fires when the session cannot be measured, the pre-gate-cut safety-net direction', () => {
		const state = state_of({ verdict: (): CostVerdict => UNMEASURABLE })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(true)
	})

	// **The cost read is gated behind the cheap checks.** A non-edit call and a call outside an uncut
	// lane child must not even reach the transcript-priced verdict.
	it.each([['Bash'], ['Read']])(
		'says nothing about a %j call without reading the verdict',
		(name) => {
			const state = state_of({ verdict: unread_verdict })

			expect(implementation_cut.is_over_threshold_edit(edit_call(name), state)).toBe(false)
		},
	)

	it('says nothing about an edit outside a lane, without reading the verdict', () => {
		const state = state_of({ directory: WORK_DIRECTORY, verdict: unread_verdict })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	it('says nothing about an edit once the cut is carried, without reading the verdict', () => {
		const state = state_of({ cut: cut_of(ISSUE), verdict: unread_verdict })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})
})

// joshuafolkken/kit#2760: a `fullrun` a person started, held in its own checkout rather than a lane, had
// no bound on its context mid-implementation. The run hold naming the issue is what marks it.
function held_run(options: StateOptions = {}): LaneCostState {
	return state_of({ directory: WORK_DIRECTORY, mark: undefined, held: ISSUE, ...options })
}

describe('is_over_threshold_edit — a run held outside a lane', () => {
	it('fires on an edit in an over-threshold held run', () => {
		expect(implementation_cut.uncut_run_issue(held_run())).toBe(ISSUE)
		expect(implementation_cut.is_over_threshold_edit(edit_call(), held_run())).toBe(true)
	})

	it('says nothing when the held run is under threshold', () => {
		const state = held_run({ verdict: (): CostVerdict => UNDER })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	// A person's own session on a provider with no transcript would otherwise be refused every edit.
	it('says nothing when the held run cannot be measured', () => {
		const state = held_run({ verdict: (): CostVerdict => UNMEASURABLE })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	// A lane's hold is its dispatched child's; a person in that lane without the mark is not that run.
	it.each([[undefined], ['2294']])('says nothing in a held lane whose mark is %j', (mark) => {
		const state = held_run({ directory: LANE_DIRECTORY, mark })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	it('says nothing once the held run has carried its cut, without reading the verdict', () => {
		const state = held_run({ cut: cut_of(ISSUE), verdict: unread_verdict })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	it('says nothing about a tree no run holds, without reading the verdict', () => {
		const state = held_run({ held: undefined, verdict: unread_verdict })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})
})

// joshuafolkken/kit#3623: the ship supervisor launches its reviewer in the implementing child's own
// checkout, so the reviewer carries that child's mark and hold. Refusing its findings `Write` sent it
// to `run:cut --impl`, which relaunched a second child beside the supervisor's own repair.
function never_priced(): CostVerdict {
	throw new Error('a reviewer session was priced')
}

describe('is_over_threshold_edit — a ship reviewer session', () => {
	it.each([[EDIT], ['Write']])('says nothing about a reviewer %j in a marked lane', (name) => {
		const state = state_of({ role: REVIEWER, verdict: never_priced })

		expect(implementation_cut.uncut_run_issue(state)).toBeUndefined()
		expect(implementation_cut.is_over_threshold_edit(edit_call(name), state)).toBe(false)
	})

	it('says nothing about a reviewer edit in a run held outside a lane', () => {
		const state = held_run({ role: REVIEWER, verdict: never_priced })

		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(false)
	})

	it('still fires on the implementing child the reviewer shares the lane with', () => {
		const state = state_of({ role: WORKER })

		expect(implementation_cut.uncut_run_issue(state)).toBe(ISSUE)
		expect(implementation_cut.is_over_threshold_edit(edit_call(), state)).toBe(true)
	})

	it('still fires on a held run launched as a worker', () => {
		expect(implementation_cut.is_over_threshold_edit(edit_call(), held_run({ role: WORKER }))).toBe(
			true,
		)
	})
})

describe('the row in the enumeration', () => {
	it('is delivered under the id implementation-cut', () => {
		const row = delivered_rules.DELIVERED_RULES.find((rule) => rule.id === IMPLEMENTATION_CUT_ID)

		expect(row?.reason).toBe(implementation_cut.IMPLEMENTATION_CUT_REASON)
	})

	// joshuafolkken/kit#2489: the unconditional setup cut is retired, so the threshold-gated row here is
	// the one cut a lane child's first edit meets — over the threshold it is still refused (the context
	// bound holds), and under it nothing else refuses the edit.
	it('is the only cut row a first edit meets, now the setup cut is retired', () => {
		const cut_rows = delivered_rules.DELIVERED_RULES.filter((rule) => rule.id.endsWith('-cut'))

		expect(new Set(cut_rows.map((rule) => rule.id))).toStrictEqual(
			new Set([IMPLEMENTATION_CUT_ID, 'pre-gate-cut']),
		)
		expect(implementation_cut.is_over_threshold_edit(edit_call(), state_of())).toBe(true)
		expect(
			implementation_cut.is_over_threshold_edit(edit_call(), state_of({ verdict: () => UNDER })),
		).toBe(false)
	})

	// **The cut this rule asks for must itself pass every row in the enumeration** — a refusal on the
	// remedy would leave a run with nothing it is allowed to do. Read from the non-lane suite checkout,
	// where every world-consulting row is silent.
	it('leaves the implementation cut command unclaimed by every rule', () => {
		const call = { name: 'Bash', input: { command: TAKE_THE_IMPL_CUT } }
		const claiming = delivered_rules.DELIVERED_RULES.filter((rule) => rule.is_trigger(call))

		expect(claiming).toStrictEqual([])
	})
})

describe('IMPLEMENTATION_CUT_REASON', () => {
	it.each([
		// The command that fixes it — the only thing that makes a refusal actionable. The `--handoff <path>`
		// is part of the actionable command, not just mentioned in prose: a resume that finds no instruction
		// is refused `incomplete`, so an "issue this now" line that dropped the flag would strand the run
		// (joshuafolkken/kit#2354).
		['pnpm josh run:cut --impl <N> --handoff <path>'],
		// What `cut` obliges, which the run cannot infer from the verdict alone.
		['end the turn immediately'],
		// That the fresh process continues implementing rather than going to the gate.
		['resume-impl'],
		// The handoff the cut must write and pass, so the resume carries the instruction
		// (joshuafolkken/kit#2354).
		['--handoff <path>'],
		['deliberately did not touch'],
		// The one measurement, so a reader knows this is not a second one (joshuafolkken/kit#1933).
		['never a second measurement'],
		// One of the verdicts that leave this process implementing.
		['not-a-lane'],
		// The pointer every delivery names.
		['.claude/skills/workflow-commands/pre-gate-cut.md'],
		// **The threshold is the shared value, assembled from the constant** (joshuafolkken/kit#2385):
		// joshuafolkken/kit#2406 derives it from the break-even model, so the old literal would tell
		// agents the wrong number — this reads the constant's current formatting.
		['135,000-token'],
		// **The reissue sentence, now the per-crossing form** (joshuafolkken/kit#2385): a reissue right
		// after a refusal passes so `busy` / `failed` cannot wedge the run, and the row fires again on the
		// next crossing rather than once per run.
		['reissued right after this refusal passes'],
		['next threshold crossing rather than once per run'],
	])('carries %j', (marker) => {
		expect(implementation_cut.IMPLEMENTATION_CUT_REASON).toContain(marker)
	})

	// **The old literal is gone, not merely joined by the new one** (joshuafolkken/kit#2385). A duplicate
	// threshold — the constant assembled beside a stray `200,000` — is exactly the drift this removes, so
	// the stale value must appear nowhere in the delivered text.
	it('carries no stale hard-coded threshold', () => {
		expect(implementation_cut.IMPLEMENTATION_CUT_REASON).not.toContain('200,000')
	})
})

describe('decide — fires per crossing, lets a reissue through', () => {
	const OVER_THRESHOLD_MS = implementation_cut.REISSUE_WINDOW_MS * 2
	const NOW_MS = 1_000_000

	// **The first over-threshold edit of a process refuses** — no prior refusal, so `delivered_at_ms` is
	// the never-fired instant and the reissue window cannot be open.
	it('refuses when this row has never fired', () => {
		expect(implementation_cut.decide(edit_call(), run_at(NOW_MS), true, 0)).toBe(true)
	})

	// **A genuinely new crossing past the window refuses again** — once per run silenced this; `decide`
	// re-asks so the growing context is watched to the end of the process.
	it('refuses a fresh crossing once the reissue window has passed', () => {
		const delivered_at_ms = NOW_MS - OVER_THRESHOLD_MS

		expect(implementation_cut.decide(edit_call(), run_at(NOW_MS), true, delivered_at_ms)).toBe(true)
	})

	// **The edit reissued right after a refusal passes** — the acceptance condition that a `busy` /
	// `failed` verdict cannot wedge the run edit after edit.
	it('lets an edit reissued inside the window through', () => {
		const delivered_at_ms = NOW_MS - 1
		const at = run_at(NOW_MS)

		expect(implementation_cut.decide(edit_call(), at, true, delivered_at_ms)).toBe(false)
	})

	// **The predicate itself, at the two edges of the window.**
	it.each([
		[0, true],
		[implementation_cut.REISSUE_WINDOW_MS - 1, true],
		[implementation_cut.REISSUE_WINDOW_MS, false],
	])('reads an age of %j ms as reissued=%j', (age, reissued) => {
		expect(implementation_cut.is_reissued_refusal(NOW_MS, NOW_MS - age)).toBe(reissued)
	})
})

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})
