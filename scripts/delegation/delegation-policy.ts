// Which steps of a run may be delegated to a cheaper execution tier (joshuafolkken/kit#969).
//
// **The decision takes no judgement.** "This one is simple enough" is a judgement made under cost
// pressure, and cost pressure resolves it toward "simple enough" exactly when a mistake is most
// likely to be shipped — the same reason `josh review:level` decides the review depth from the
// changed paths rather than from how big the change feels.
//
// So the list is an enumeration and **anything not on it is kept**. A step nobody thought about
// lands on the expensive side, which is the direction that costs money rather than correctness.

type DelegationVerdict = 'delegate' | 'keep'

const DELEGATE_VERDICT: DelegationVerdict = 'delegate'
const KEEP_VERDICT: DelegationVerdict = 'keep'

interface DelegatableStep {
	name: string
	// What the cheaper tier is asked to do.
	does: string
	// **The reason it may be delegated at all.** A step is delegatable only when a wrong result is
	// *caught*, not merely unlikely — and caught by something that runs in the parent tier and costs
	// less than redoing the step. Without that, a quiet mistake ships.
	verifier: string
}

// Where the pre-implementation reading stops being cheaper in the main line (joshuafolkken/kit#1426).
//
// **A count, not a forecast.** The reads are counted as they are made rather than predicted before
// the investigation starts, so nothing here rests on guessing how large it will be. Two files the run
// will not edit stay in the main line, because delegating costs two extra main-line turns — one to
// write the brief, one to read the result, about 18 seconds at run #1406's measured 8.8 s of model
// wait per turn — and below the threshold that round trip costs more than carrying the text.
const INVESTIGATION_FILE_THRESHOLD = 3

// The enumeration. Short on purpose: every entry had to name a verifier, and most candidates could
// not (below).
const DELEGATABLE_STEPS: ReadonlyArray<DelegatableStep> = [
	{
		name: 'gate-fix',
		does: 'apply the fixes the verification gate already named — a lint rule, a type error, a spelling the dictionary rejects',
		verifier:
			'`pnpm josh gate` is re-run; a wrong fix fails it again, and the failure names the file',
	},
	{
		name: 'epic-child',
		// One row, two entry points: an epic's child under `epicrun` and one issue of a `queue` are
		// the same unit — same brief, same summary, same verifier (joshuafolkken/kit#1149). A second
		// row for the queue would be the clone `CLAUDE.md` prohibits.
		does: "run one child of a batch end to end in an isolated unit — an epic's child under `epicrun` or one issue of a `queue` alike — plan, verification gate, PR, merge — and return only its summary to the parent loop",
		verifier:
			"the parent reads the child's state from GitHub with `pnpm josh issue:state`, not from the summary; a child reported done but not merged is still open, which is the failure showing rather than a run continuing, and its own gate, `/code-review` and CI ran inside the unit before `followup --merge` would touch the PR",
	},
	{
		name: 'survey',
		does: 'read across many files and report where something appears — every reference to a symbol, which documents carry a marker',
		verifier:
			'the reported locations are checked directly; a fabricated or missed location does not survive one `grep` of what it claimed',
	},
	{
		name: 'investigation',
		// Not `survey`: that row reports *where* something appears and is checked by one `grep`, while
		// this one reports *how the subject works* and is checked by opening the lines it cited. The two
		// verifiers differ, so widening `survey` would put both in one field and lose the boundary below.
		// **No ordinal.** `${N}rd` would print `1rd` for any other threshold, past a test that only looks
		// for the numeral, so the count is phrased as a plain "N or more".
		does: `read the Issue's subject to find out how it currently works — once ${String(INVESTIGATION_FILE_THRESHOLD)} or more files the run will not edit have to be read — and return the conclusion plus the \`file:line\` citations that support it, never the file text, which would put the cost back where it was. A throwaway probe script is written, run and deleted inside the unit, which returns its output alone`,
		verifier:
			'the parent opens the cited lines; a conclusion those lines do not support fails there, and reading a handful of cited regions costs far less than redoing the reading. The unit reports what the code does and never what to change — deciding that is `diagnosis`, which stays kept, so a unit returning a root cause would be delegating the rejected row under this name',
	},
]

// Steps that were considered and are **not** delegatable, kept as a list rather than dropped: the
// next person to propose one of them should find the reason rather than re-derive it.
interface RejectedStep {
	name: string
	because: string
}

const REJECTED_STEPS: ReadonlyArray<RejectedStep> = [
	{
		name: 'notify-body',
		because:
			'no verifier. A notification with a wrong body is sent and read as though it were right; nothing in the run disagrees with it afterwards',
	},
	{
		name: 'issue-comment',
		because:
			'no verifier. A decision log or completion comment that says the wrong thing is the record, so there is nothing left to check it against',
	},
	{
		name: 'status-read',
		because:
			'a misread routes the run to the wrong child, and no later step disagrees. Running the status command is already cheap; what is expensive is acting on it, which is not this step',
	},
	{
		name: 'diagnosis',
		because: 'a wrong root cause produces a fix that passes the gate and leaves the defect',
	},
	{
		name: 'design',
		because: 'the cost of a wrong design is paid by every step after it',
	},
	{
		name: 'split-assessment',
		because: 'a missed split widens one Issue into a batch nobody authorized',
	},
	{
		name: 'review',
		because: 'the review is the last thing between a defect and a merge; a cheaper one finds less',
	},
]

function find_step(name: string): DelegatableStep | undefined {
	return DELEGATABLE_STEPS.find((step) => step.name === name.trim())
}

function verdict_for(name: string): DelegationVerdict {
	return find_step(name) === undefined ? KEEP_VERDICT : DELEGATE_VERDICT
}

function rejection_for(name: string): RejectedStep | undefined {
	return REJECTED_STEPS.find((step) => step.name === name.trim())
}

// Why the answer is what it is. A verdict with no reason is a rule an agent cannot check itself
// against, and `keep` is the answer that most needs one — most of the time it means "nobody has
// listed this", not "this was judged too risky".
function reason_for(name: string): string {
	const step = find_step(name)

	if (step !== undefined) return `delegatable: ${step.verifier}`

	const rejected = rejection_for(name)

	if (rejected !== undefined) return `kept deliberately: ${rejected.because}`

	return 'kept by default: not on the delegatable list, and the list is the whole of it'
}

const delegation_policy = {
	DELEGATE_VERDICT,
	INVESTIGATION_FILE_THRESHOLD,
	KEEP_VERDICT,
	DELEGATABLE_STEPS,
	REJECTED_STEPS,
	find_step,
	verdict_for,
	rejection_for,
	reason_for,
}

export type { DelegatableStep, DelegationVerdict, RejectedStep }
export { delegation_policy }
