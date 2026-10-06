import { bash_triggers } from './bash-triggers'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `wip-cap` row of `delivered-rules.ts`, moved out of
// the enumeration so the list stays a list (joshuafolkken/kit#3264).

// The whole of the WIP cap, in the shape a refusal can carry: the count, the refusal, the two
// exemptions and the three tests that decide the second one. The three tests are spelled out rather
// than named, because a delivery that said only "an interrupt is exempt" would hand the deciding back
// to judgement at exactly the moment nothing else is open to read (joshuafolkken/kit#1518).
// `WIP_CAP` is the number's single source; `wip-cap.md` states it once and a test pins the two equal.
const WIP_CAP = 30
const WIP_CAP_REASON =
	`⛔ backlog WIP cap: \`pnpm josh issue:file\` counts the target repository's open Issues before filing. With more than ${String(WIP_CAP)} ` +
	'open, close one first; nothing honestly closable means do not file — the command holds such a filing. ' +
	'Two filings are exempt and proceed while stating the overage — one the run is blocked by (`--over-cap`, ' +
	'or the `tier-a` / `split` route), and an interrupt (`--route interrupt`), decided by three tests rather ' +
	'than judgement: a verification answers wrongly, a documented workflow cannot complete, or data is lost ' +
	'or written outside the repository. Meeting none of the three, the finding is discretionary and waits. ' +
	'Both procedures are in `prompts/collaboration-workflow/wip-cap.md`. Reissue this call and let the ' +
	'command count — it fires once per run and cannot repeat on the call in hand.'

// **Keeping the WIP cap is counting the open Issues**, which is the one act the rule asks for before
// a filing.
//
// **It has to be Issues, open, and a listing — all three, in one segment.** A pattern that took any
// of them alone scored `gh pr list --state open` and `epic:bundle`'s candidate search as the count,
// and those inflate exactly the ratio the retirement decision reads. `gh issue list` alone is not
// enough either: the cap is about *open* Issues, and a listing that does not say so is some other
// question. Segment-wise like the comments predicate, so a spelling quoted inside a filing's body
// is not read as the count that filing skipped.
const ISSUE_LISTING = /^gh\s+(?:-{1,2}[\w-]+(?:[= ]\S+)?\s+)*issue\s+list\b/u
const ISSUES_QUERY = /repos\/[^\s'"]*\/issues\?[^\s'"]*state=open/u
const OPEN_STATE = /--state[= ]open|state=open/u
// **A label filter makes it a different question.** `gh issue list --label epic --state open` and
// `…/issues?labels=epic&state=open` ask which epics are open, which is what `epic:bundle` and the
// Issue template do; counting either as the WIP count would credit the cap as kept by a run that
// never counted the backlog. The residual the pattern cannot separate is named in
// `docs/josh-commands.md`: the inventory command in the `diag` skill is byte-identical to a hand count
// of the backlog, so no pattern can tell those two apart.
const LABEL_FILTER = /--label\b|[?&]labels=/u

function counts_open_issues(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => {
		if (LABEL_FILTER.test(segment)) return false

		return (ISSUE_LISTING.test(segment) && OPEN_STATE.test(segment)) || ISSUES_QUERY.test(segment)
	})
}

// The enumeration row itself, so `delivered-rules.ts` spreads one entry rather than restating the
// trigger and reason it already single-sources here. Once per run: the refusal changes what the run
// knows, so the reissue is let through.
const ROW = {
	id: 'wip-cap',
	is_trigger: bash_triggers.on_bash_command(bash_triggers.is_issue_filing),
	reason: WIP_CAP_REASON,
	keeps: bash_triggers.on_bash_command(counts_open_issues),
}

const wip_cap = { ROW, WIP_CAP, WIP_CAP_REASON }

export { wip_cap }
