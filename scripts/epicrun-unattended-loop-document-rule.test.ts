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

const COST_COMMAND = 'pnpm josh cost --over 300000'
const DELEGATE_COMMAND = 'pnpm josh delegate epic-child'

// The two halves of the detection, each asserted twice — present in the skill, absent from the
// pointer. Written out twice they would drift, and a pointer suite matching a marker the skill no
// longer carries reports a body left behind that is not there.
const CONJUNCTION_RULE = 'Silence and no process, together — never either one alone'
const WINDOW_ROW = '| Silent delegated unit | 30 min |'

describe(`${SKILL} — the cost check is asked at every merge`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// joshuafolkken/kit#1212 conditioned the check on the child having run in the parent's own
	// context; joshuafolkken/kit#1567 measured a parent that delegated every child and reached the
	// threshold anyway, so the condition exempted exactly the run that needed the check.
	it('states that there is no delegation condition left', () => {
		expect(unwrapped).toContain("is asked after every child's merge")
	})

	// `epic-child` is a literal entry in the enumeration, so the command answers `delegate` on every
	// machine forever. A gate wired to it never fires once — the defect the first draft shipped, and
	// the reason the prohibition outlives the condition it was written against.
	it('refuses the delegation command as the condition', () => {
		expect(unwrapped).toContain(
			`Never wire the question to \`${DELEGATE_COMMAND}\`** — that is a static policy lookup`,
		)
	})

	// The rule has to be reachable by following the numbered steps, and the prohibition with it —
	// a reader working through the loop never meets the section that argues it.
	it('states the gate and its prohibition inside the loop', () => {
		const step = epicrun_loop.per_child_step()

		expect(step).toContain("at every child's merge, delegated or not")
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

describe(`${SKILL} — reaching the threshold hands the lanes over`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('takes no new child once the threshold is reached', () => {
		expect(unwrapped).toContain('Open no new lane and take no new child from `epic:next`')
	})

	// joshuafolkken/kit#1713: the lanes already running are handed to the next session rather than
	// waited on. A reword that lost this puts the pool decay back — six seats to zero, for as long as
	// the longest child still running.
	it('hands the in-flight lanes over instead of waiting for them', () => {
		expect(unwrapped).toContain('Every lane in flight is handed over')
		expect(unwrapped).toContain('There is no waiting here at all')
	})

	// Without a seam the run can reach, the rule is unreachable under `--lanes`, which keeps the seats
	// full: the run joshuafolkken/kit#1567 measured would have read `over` at every merge and cut at
	// none of them. The hand-over is what reaches it now; the drain is what used to.
	it('says why the cut is reachable, and what the drain it replaced cost', () => {
		expect(unwrapped).toContain(
			'The hand-over is what makes the cut reachable, and the drain it replaced cost the pool.',
		)
		expect(unwrapped).toContain('it would have read `over` at all seven merges')
	})

	// An unreadable lane cannot be told apart from a running child, so it withholds the cut rather
	// than being counted idle — a wrong cut abandons a child, a missed cut only costs tokens.
	it('never reads an unreadable lane as idle', () => {
		expect(unwrapped).toContain('**Never assume idle.**')
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

// The hand-over is the means; the cut is the end of it. A reword that keeps only the first strands a
// run that recorded every path and then carried on with nothing left to hand over.
describe(`${SKILL} — the cut the hand-over reaches`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('stops and asks once every in-flight lane can be polled', () => {
		expect(unwrapped).toContain('**Every in-flight lane records a path**')
		expect(unwrapped).toContain('stop and ask the person to cut the session')
		expect(unwrapped).toContain(
			'Please run `epicrun #<E>` to continue this epic in a fresh session.',
		)
	})

	// The stopping conditions are read as the exhaustive list, so the qualifier has to be there too —
	// otherwise the list says a bare `over` ends the run whatever state the lanes are in.
	it('qualifies the stopping condition rather than leaving it bare', () => {
		const content = read_repo_file(SKILL)
		const conditions = content
			.slice(content.indexOf('## Stopping conditions'))
			.replaceAll(/\s+/gu, ' ')

		expect(conditions).toContain(COST_COMMAND)
		expect(conditions).toContain(
			'every lane still in flight records the path the next session will poll it on',
		)
		expect(conditions).toContain('**The reading stops the run in its own turn**')
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

	// joshuafolkken/kit#1485 replaced the four hand-read traces with one command, because combining
	// them was the judgement that got it wrong. What is pinned now is the invocation and the four
	// answers, so an agent has something to run rather than a conjunction to evaluate.
	it.each([
		'pnpm josh run:liveness <N> --output <path> --process none',
		'| `alive` |',
		'| `stopped` |',
		'| `settled` |',
		'| `undetermined` |',
	])('enumerates the answer %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	// One half alone has an innocent reading — a unit inside a long check writes nothing, and a unit
	// that is only reading runs no check — so acting on either would kill a working unit.
	it('requires both halves rather than either one', () => {
		expect(unwrapped).toContain(CONJUNCTION_RULE)
	})

	// The direction of the error is the design: a live unit booked as stopped loses work, so every
	// trace that could not be read falls the other way.
	it('falls to undetermined rather than to a stop', () => {
		expect(unwrapped).toContain(
			'a trace that could not be read answers `undetermined`, never `stopped`',
		)
	})

	it('pins the window in the waiting table', () => {
		expect(content).toContain(WINDOW_ROW)
	})
})

// The two ways the new answer could itself fall back to never firing: a poll that keeps saying
// nothing, and the dirty-checkout requirement that made the old test unsatisfiable.
describe(`${SKILL} — the detection cannot fall back to never firing`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it('bounds a repeating undetermined without escalating it to a stop', () => {
		expect(unwrapped).toContain(
			'**Two `undetermined` answers in a row is a fault in the check, not a slow unit.**',
		)
		expect(unwrapped).toContain('**It is never escalated to a `stopped`**')
	})

	it('says a clean checkout is not evidence of life', () => {
		expect(unwrapped).toContain('A clean checkout is not evidence that the unit is alive.')
		expect(unwrapped).toContain('"Nothing was ever opened for the child" is not part of it either.')
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
			'**Start the unit without blocking on it — `pnpm josh lane:dispatch <N>` when the child runs in a lane, which records where it writes as it starts it — and poll.**',
		)
		expect(unwrapped).toContain(
			'So the parent checks rather than waiting — which means it must not be waiting.',
		)
	})

	// The path is the one thing the parent cannot recover afterwards; the timestamp is not, and
	// carrying it forty minutes is what made the symlink misread invisible (joshuafolkken/kit#1485).
	it('records the path at hand-off and reads the timestamp from the file', () => {
		expect(unwrapped).toContain(
			'**Note where the unit writes at hand-off; the modification time is read from the file, not carried.**',
		)
	})

	// A unit given its own work tree leaves the parent's checkout clean, so traces read against the
	// parent would both come back false and the stash would save nothing.
	it('says which checkout the traces are read in', () => {
		expect(unwrapped).toContain('read **in the checkout the unit was given**')
	})

	// The two ways a trace was written so it could never answer: a `pgrep` by command name on a machine
	// that runs several kit projects at once by design, and a modification time read off a symlink,
	// whose own timestamp never moves. The branch-and-pull-request read is gone with the trace it
	// belonged to — `josh run:preflight` owns that question at the start of the next child.
	it.each([
		'**A bare command-name match is not the test**',
		'**Read the file the path points at, not the link.**',
		'a `stat` typed by hand needs `-L`',
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
		'naming what `run:liveness` answered and what it read',
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
		expect(unwrapped).toContain('まだ止まっていないランは区切りの報告を書かない')
		// The format serves every entry point, so conditioning it on lane state would leave the one
		// that opens no lane unable to satisfy it — and falling back to the format it forbids.
		expect(unwrapped).toContain('この書式を lane の状態で条件づけない')
		expect(unwrapped).toContain('閾値を超えたこと自体は区切りではなく、停止したことが区切りである')
	})
})

// The pointer indexes what the skill holds so a reader can tell whether something was folded in or
// dropped. It records the location, never the body.
describe(`${POINTER} — records the new rules without restating them`, () => {
	const unwrapped = read_unwrapped(POINTER)

	it.each([
		'子のマージごとに必ず問う',
		'`over` を読んだそのターンで停止して',
		'委譲した実行単位が報告せず停止したことを親が検知する手順',
	])('names %j as something the skill holds', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	it('keeps none of the detection body', () => {
		expect(unwrapped).not.toContain(CONJUNCTION_RULE)
		expect(unwrapped).not.toContain(WINDOW_ROW)
	})
})
