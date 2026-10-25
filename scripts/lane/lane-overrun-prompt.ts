import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_priority } from '#scripts/issue/issue-priority'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'

// What an overrun investigation's session does with the causes it found (joshuafolkken/kit#4751) —
// group, fold or file each, and record the result — the part of its prompt that reads no record.
// `lane-overrun.ts` puts what the session reads ahead of it.

// What a duplicate refusal leads to. A recurrence puts the ranked lines in the open issue's body
// too, because the backlog ranking reads them only there (joshuafolkken/kit#4859).
function duplicate_lines(loss_lines: string): ReadonlyArray<string> {
	return [
		'On a duplicate refusal, read each candidate with `pnpm josh issue:read <N>`: one that only fixes',
		'another mechanism, or is only cited, is distinct — reissue with `--distinct <N,…>`; an open one that',
		'fixes the same mechanism is not filed again but gets a comment recording the recurrence with those four',
		`and ${loss_lines}, and gets those lines added under its background heading too (ranking reads only`,
		'the body: `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -F body=@<file>`); one closed before',
		'this lane yet recurring here is filed anew as a recurrence, its number in `--distinct`.',
		'A cap refusal is final: stop filing.',
	]
}

// The filing command: an overrun's filings name the lane they were found during; the baseline's name none.
function file_command(origin: number | undefined): string {
	if (origin === undefined) return 'pnpm josh issue:file'

	return `pnpm josh issue:file --found-during ${String(origin)}`
}

// Each lane pays a fixed review-to-merge cost, so causes one fix place shares are one issue. A fold
// skips `issue:file`, so it carries the ranked lines; the lane's minutes give it no label.
function grouping(origin: number | undefined, loss_lines: string): string {
	return [
		'Causes whose fixes touch the same file or mechanism are one issue, an acceptance criterion per',
		'cause; causes fixed in different places are separate issues. Before filing one, look for an open',
		'issue that touches the same files (`pnpm josh issue:scout "<title>" --body-file <draft.md>`, each',
		'candidate read with `pnpm josh issue:read <N>`): when one does, fold its causes into it by',
		'`.claude/skills/workflow-commands/issue-fold-existing.md` instead of filing, the appended part',
		`carrying ${loss_lines}; on a verdict other than \`fold\`, file as below.`,
		'File each other issue with',
		`\`${file_command(origin)}\`, its body carrying those four per cause, and`,
		`${loss_lines} under its background heading, the cause-loss minutes being what that issue's own`,
		"causes spent — backlog ranking orders one priority by them, else by the lane's minutes, which every",
		'cause of the lane shares, so a filing without either falls behind every declared one.',
	].join(' ')
}

// A filing's priority is the reduction it states, and `issue:file` refuses one under the high share,
// which would not pay back the lane its fix takes (joshuafolkken/kit#4870). Such a cause is still
// recorded under its mechanism's key, and the key's sum across lanes is judged before the cause is
// dropped, since one mechanism losing a little in every lane is not small (joshuafolkken/kit#4886).
// `sum_lines` say how the key's sum is reached: one lane's cause adds to it, a baseline's is it already.
function small_cause_lines(sum_lines: ReadonlyArray<string>): ReadonlyArray<string> {
	const percent = `${String(issue_priority.HIGH_PERCENT)}%`
	const suffix = run_event_overrun.small_causes_text([
		{ key: '<key>', minutes: '<minutes>', cause: '<cause, in a few words>' },
	])

	return [
		`A cause whose fix saves under ${percent} of the median lane time per merge`,
		'(`- 1 マージあたりの短縮:`) is not filed on its own — `issue:file` refuses it under `- 目的: 時間短縮`.',
		'Key it by its mechanism (a josh command or step, e.g. `test:pinned`), reusing the key',
		'`pnpm josh overrun:mechanisms` lists for the same mechanism.',
		...sum_lines,
		`At ${percent} or over, the mechanism is one root-cause issue — fold into an open issue that fixes it`,
		"as above, else file it with the key's summed minutes as its cause-loss line and the summed share as",
		`its reduction. Under ${percent}, fold it into an open issue as above, else end the result below`,
		`with \`${suffix}\`, the segments of several causes joined by \`; \`. The key's cause count is the`,
		'recurrence to put into its `効く率`.',
	]
}

// The result's vocabulary, recorded as the note `template` names with `<result>` in it.
function result_lines(template: string): ReadonlyArray<string> {
	return [
		`Then record the result: \`pnpm josh run:event --append note "${template}"\`,`,
		`the result being \`${run_event_overrun.folded_result(['<A>', '<B>'])}\` naming every issue you folded into`,
		`when you folded any, else \`${run_event_overrun.FILED_RESULT}\` when you filed any, \`${run_event_overrun.recurred_result('<N>')}\``,
		`when you only commented a recurrence on #<N>, else \`${run_event_overrun.none_result('<why, in about 15 characters>')}\`.`,
	]
}

// How an investigation's causes are handled: the lane its filings were found during, if any, the ranked
// lines each filing carries, the note its result is recorded as, and how a small cause's key sum is
// reached.
interface CauseHandling {
	origin: number | undefined
	loss_lines: string
	template: string
	sum_lines: ReadonlyArray<string>
}

// The filing rules an investigation's causes follow, shared by the overrun and the baseline
// investigation (joshuafolkken/kit#4887).
function cause_handling(rules: CauseHandling): string {
	return [
		grouping(rules.origin, rules.loss_lines),
		...small_cause_lines(rules.sum_lines),
		...duplicate_lines(rules.loss_lines),
		...result_lines(rules.template),
	].join(' ')
}

// One lane's small cause is a share of its mechanism's loss, so it is judged by the sum over the lanes.
const LANE_SUM_LINES = [
	"Before dropping it, run that command: add the cause's minutes to its key's sum and divide by the",
	'merges and the median lane it prints. When a closed issue already fixed the mechanism, re-run it with',
	'`--since <that close time>` and judge only that sum — the losses before the fix are gone.',
]

// The lines backlog ranking reads (joshuafolkken/kit#4861): the cause's own minutes, else the lane's
// `minutes`, cited to lane `issue`.
function loss_lines_of(issue: number, minutes: string): string {
	const cite = issue_cite.plain(issue)

	return `\`- 原因のレーン: ${minutes} 分（${cite}）\` and \`${issue_priority.CAUSE_PREFIX} <分> 分\``
}

// The handling of lane `issue`'s causes, its `minutes` of net time on each filing's ranked lines.
function handling(issue: number, minutes: number): string {
	return cause_handling({
		origin: issue,
		loss_lines: loss_lines_of(issue, String(minutes)),
		template: run_event_overrun.ended_text(issue, '<result>'),
		sum_lines: LANE_SUM_LINES,
	})
}

const lane_overrun_prompt = { cause_handling, handling, loss_lines_of }

export { lane_overrun_prompt }
