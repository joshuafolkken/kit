import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { epicrun_loop, EPICRUN_SKILL } from '#scripts/epicrun-loop-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1212: running joshuafolkken/kit#1176 needed a person three times between
// children, and not one of those three was a decision anybody had to make. All three are the parent
// loop holding an assumption about the delegated unit, or about its own context, that stopped being
// true when joshuafolkken/kit#984 moved each child into an isolated unit.
//
// 1. The cost question was asked after every merge, including while delegation was keeping the
//    parent's context flat — the section itself already called the threshold insurance for a run
//    that cannot delegate, and then fired regardless of whether delegation was available.
// 2. Reaching the threshold sent the person back to the keyboard to retype `epicrun #<E>`, though
//    the workflow deliberately carries nothing in the conversation and a fresh session pays about
//    70,000 tokens to read back what a compaction would have kept for nothing.
// 3. A unit stopped from outside notified nobody, so the loop reported a child as running for
//    1 h 45 min while nothing at all was happening — and every guard in the file assumes the unit is
//    running, so no guard could catch it.
//
// These are marker assertions rather than behavioral ones because the loop is a procedure an agent
// reads, exactly as every other `epicrun` rule in this suite family is.

const SKILL = EPICRUN_SKILL
const POINTER = 'prompts/collaboration-workflow/epicrun.md'
const FORMAT = 'prompts/collaboration-workflow/report-format.md'

const COST_COMMAND = 'pnpm josh cost --over 400000'
const DELEGATE_COMMAND = 'pnpm josh delegate epic-child'

// The two halves of the detection, each asserted twice — present in the skill, absent from the
// pointer. Written out twice they would drift, and a pointer suite matching a marker the skill no
// longer carries reports a body left behind that is not there.
const CONJUNCTION_RULE = 'All four together, never any one alone'
const WINDOW_ROW = '| Silent delegated unit | 30 min |'

describe(`${SKILL} — the cost check fires only where delegation is unavailable`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// The condition is a fact the parent holds — whether it delegated this child — not a judgement
	// about how full the context feels.
	it('names what decides the firing condition', () => {
		expect(unwrapped).toContain(
			'what decides that is whether the child that just merged actually ran in a delegated unit',
		)
	})

	// The defect the first draft shipped: `epic-child` is a literal entry in the enumeration, so the
	// command answers `delegate` on every machine forever. A gate wired to it never fires once, and
	// the run that most needs the threshold — one with no isolated unit at all — sails past it.
	it('refuses the delegation command as the condition', () => {
		expect(unwrapped).toContain(
			"It is not `pnpm josh delegate epic-child`'s answer, and wiring it to that would delete the insurance rather than condition it.",
		)
		expect(unwrapped).toContain('static policy lookup')
	})

	// The rule has to be reachable by following the numbered steps, and the prohibition with it —
	// a reader working through the loop never meets the section that argues it.
	it('states the gate and its prohibition inside the loop', () => {
		const step = epicrun_loop.per_child_step()

		expect(step).toContain("it does only where **this child ran in this session's own context**")
		expect(step).toContain(COST_COMMAND)
		expect(step).toContain(`Never read the condition off \`${DELEGATE_COMMAND}\``)
	})

	// The figures are what make "delegation keeps the parent flat" a measurement rather than a
	// belief; a reader who doubts the gate has to be able to check it.
	it.each(['128,675', '155,069', '272,528', '4,000 to 5,000 per child'])(
		'cites the measured growth: %j',
		(figure) => {
			expect(unwrapped).toContain(figure)
		},
	)
})

describe(`${SKILL} — reaching the threshold no longer sends the person back to the keyboard`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('continues the loop on `over`', () => {
		expect(unwrapped).toContain(
			'go back to step 1 and run the next child. Do not ask the person to retype the command.',
		)
	})

	// The safety argument, not a preference: the loop reads every piece of its state back from
	// GitHub, so a summarized session answers exactly what a fresh one does.
	it('says why compacting is safe here', () => {
		expect(unwrapped).toContain('A session that compacts is safe for this workflow')
		expect(unwrapped).toContain('nothing is carried in the conversation')
	})

	// The one thing the conversation *does* hold. `over` used to end the session, so the guard
	// counters died with a session that was over anyway; a session that carries on loses them
	// mid-run, and the consecutive-failure guard is what the stopped-unit section leans on.
	it('records the guard counters a compaction would take', () => {
		expect(unwrapped).toContain(
			"Write the run's counters into the epic progress comment at every child's merge",
		)
		expect(unwrapped).toContain(
			'Every guard in the Guards table is counted in the conversation and nowhere else',
		)
	})

	// Persisting them only at an `over` reading would not work: a compaction happens under context
	// pressure, at whatever moment the pressure arrives, and mid-child as readily as at a merge.
	it('persists them at every merge rather than only where the run expected to stop', () => {
		expect(unwrapped).toContain(
			'It is every merge and not only an `over` reading, because a compaction is not something the run chooses.',
		)
	})

	// The counters are not what "Nothing is carried in the conversation" denies — that is about the
	// state a *next* session needs, and a reader who conflates the two deletes this rule as a
	// contradiction.
	it('separates the counters from the state a next session reads back', () => {
		expect(unwrapped).toContain('This is not what "Nothing is carried in the conversation" denies.')
	})
})

// Continuing is the new default; stopping is what is left of the old rule. Both halves have to
// survive, and the second is the one a reword drops — it strands a run whose context is genuinely
// exhausted with no defined ending.
describe(`${SKILL} — the escape route the hand-off keeps`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('keeps the stop for a session that cannot continue', () => {
		expect(unwrapped).toContain('**`over`, where the session cannot continue at all**')
		expect(unwrapped).toContain('The escape route stays exactly as it was')
		expect(unwrapped).toContain(
			'Please run `epicrun #<E>` to continue this epic in a fresh session.',
		)
	})

	// The stopping conditions are read as the exhaustive list, so a condition that has gained a
	// qualifier has to gain it there too — otherwise the list still says a bare `over` ends the run.
	it('qualifies the stopping condition rather than leaving it bare', () => {
		const content = read_repo_file(SKILL)
		const conditions = content
			.slice(content.indexOf('## Stopping conditions'))
			.replaceAll(/\s+/gu, ' ')

		expect(conditions).toContain(COST_COMMAND)
		expect(conditions).toContain('and this session cannot continue')
		expect(conditions).toContain('**`over` on its own is no longer on this list**')
	})
})

describe(`${SKILL} — a delegated unit that stopped without reporting`, () => {
	const content = read_repo_file(SKILL)
	const unwrapped = read_unwrapped(SKILL)

	it('has the section as a heading of its own', () => {
		expect(content).toMatch(/^## A delegated unit that stopped without reporting$/mu)
	})

	// Why it is worth a section at all: the existing guards cannot see it, so without this one the
	// failure mode has no owner.
	it('says the existing guards cannot catch it', () => {
		expect(unwrapped).toContain('Every guard in this file assumes the unit is running')
		expect(unwrapped).toContain('a unit that is not running trips none of them')
	})

	// The traces are the whole detection. Enumerated in the document, per the Issue's acceptance
	// criterion, so an agent has something to read rather than a judgement to make.
	it.each([
		"The unit's output has not changed.",
		'The checkout is dirty, and nothing was ever opened for the child.',
		"No process of the child's is alive in that checkout.",
		'The child still carries `in-progress`.',
	])('enumerates the trace %j', (trace) => {
		expect(unwrapped).toContain(trace)
	})

	// One trace alone has an innocent reading, and acting on it would kill a working unit.
	it('requires all four rather than any one', () => {
		expect(unwrapped).toContain(CONJUNCTION_RULE)
	})

	it('pins the window in the waiting table', () => {
		expect(content).toContain(WINDOW_ROW)
	})
})

// Three ways the detection can be present in the document and unreachable in the run: no turn to
// execute in, no baseline to compare against, and traces read against the wrong checkout. Each was
// true of the first draft, and none of them shows up as a missing rule.
describe(`${SKILL} — the detection can actually run`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// A parent blocked on the unit's return is waiting for exactly the return a stopped unit never
	// makes.
	it('gives the detection somewhere to execute', () => {
		expect(unwrapped).toContain(
			'**Start the unit without blocking on it, note where it writes and the modification time of that file, and poll.**',
		)
		expect(unwrapped).toContain(
			'So the parent checks rather than waiting — which means it must not be waiting.',
		)
	})

	// Trace 1 compares against a previous reading, so the first check has nothing to compare against
	// unless the baseline was taken at hand-off — and a trace nothing can evaluate makes the conjunction
	// unsatisfiable rather than merely uncertain.
	it('takes the baseline at hand-off', () => {
		expect(unwrapped).toContain(
			'**Record the baseline when the child is handed over, not at the first check.**',
		)
	})

	// A unit given its own work tree leaves the parent's checkout clean, so traces read against the
	// parent would both come back false and the stash would save nothing.
	it('says which checkout the traces are read in', () => {
		expect(unwrapped).toContain('read **in the checkout the unit was given**')
	})

	// Two of the four were first written so they could never fire: a `--head <branch>` read with no
	// branch to name, and a `pgrep` by command name on a machine that runs several kit projects at
	// once by design. Either one held false forever makes the conjunction above undetectable.
	it.each([
		"git branch --list '<N>-*'",
		'**A bare command-name match is not the test**',
		'**`--state all` is not optional either**',
	])('keeps the trace readable: %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})
})

// Detecting the stop is half of it; what the parent then does with the child is the other half, and
// it is the failure path that already exists rather than anything new.
describe(`${SKILL} — what a stopped unit's child gets`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// Each of the three steps is load-bearing on its own: the stash keeps the next child off a dirty
	// tree, the label keeps the repository from being held, and the count is what lets the guard see
	// an environment fault rather than a run of unlucky children.
	it.each([
		'git stash push -u -m "epicrun: stopped unit for #<N>"',
		'gh api -X DELETE repos/{owner}/{repo}/issues/<N>/labels/in-progress',
		'Count it against the consecutive-failure guard and park it',
	])('books it as a failed child: %j', (step) => {
		expect(unwrapped).toContain(step)
	})

	// A retry would re-run a child on a half-written tree, and would keep the guard from ever seeing
	// that the environment rather than the children is at fault.
	it('books it as a failure rather than restarting it', () => {
		expect(unwrapped).toContain('It is booked as a failure rather than restarted')
	})

	// Parking continues the loop; only the consecutive-failure guard turns it into a stop.
	it('keeps it off the stopping conditions', () => {
		expect(unwrapped).toContain('Neither is a delegated unit that stopped without reporting')
	})
})

// The hand-off report names what somebody else has to pick up. A run that read `over` and carried on
// has nobody to hand to, so writing the four lines there would announce a stop that did not happen —
// the mirror of the mistake joshuafolkken/kit#984 fixed, where a stop was reported as a completion.
describe('the hand-off report is tied to the stop, not to the reading', () => {
	it('states the boundary in the procedure', () => {
		expect(read_unwrapped(SKILL)).toContain(
			'The hand-off report belongs to the stop, not to the reading.',
		)
	})

	it('states the same boundary in the format that defines the report', () => {
		const unwrapped = read_unwrapped(FORMAT)

		expect(unwrapped).toContain('この書式は「止まったとき」だけのものである')
		expect(unwrapped).toContain('続行したランは区切りの報告を書かない')
		expect(unwrapped).toContain('閾値を超えたこと自体は区切りではなく、停止したことが区切りである')
	})
})

// The pointer indexes what the skill holds so a reader can tell whether something was folded in or
// dropped. It records the location, never the body.
describe(`${POINTER} — records the new rules without restating them`, () => {
	const unwrapped = read_unwrapped(POINTER)

	it.each([
		'それを問うのが子を親の文脈で走らせたときだけであること',
		'閾値を超えても停止せず続けること',
		'委譲した実行単位が報告せず停止したことを親が検知する手順',
	])('names %j as something the skill holds', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	it('keeps none of the detection body', () => {
		expect(unwrapped).not.toContain(CONJUNCTION_RULE)
		expect(unwrapped).not.toContain(WINDOW_ROW)
	})
})
