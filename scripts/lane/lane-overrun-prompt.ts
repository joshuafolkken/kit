import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_priority } from '#scripts/issue/issue-priority'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'

// What an overrun investigation's session does with the causes it found (joshuafolkken/kit#4751) —
// pick, group, fold or file each, and record the result — the part of its prompt that reads no record.
// `lane-overrun.ts` puts what the session reads ahead of it.

// The most causes one investigation files, and the fewest minutes one must cut to be filed
// (joshuafolkken/kit#4928).
const MAX_FILINGS = 5
const MIN_MINUTES = 1
const PRIORITY_COMMAND = 'pnpm josh issue:priority <N>'

// What a duplicate refusal leads to. A recurrence appends its own cause-loss line to the open issue's
// body, because the backlog ranking reads them only there and sums them (joshuafolkken/kit#4859,
// joshuafolkken/kit#4928); the sum can then reach the high floor, which a body edit does not label
// (joshuafolkken/kit#4960).
function duplicate_lines(loss_lines: string): ReadonlyArray<string> {
	return [
		'On a duplicate refusal, read each candidate with `pnpm josh issue:read <N>`: one that only fixes',
		'another mechanism, or is only cited, is distinct — reissue with `--distinct <N,…>`; an open one that',
		'fixes the same mechanism is not filed again but gets a comment recording the recurrence with those four',
		`and ${loss_lines}, and gets those lines added under its background heading too, the cause-loss line`,
		`appended beside the ones already there, since ranking sums every \`${issue_priority.CAUSE_PREFIX}\` line`,
		'and reads only the body (`gh api -X PATCH repos/{owner}/{repo}/issues/<N> -F body=@<file>`). Then',
		`run \`${PRIORITY_COMMAND}\`, which labels it once the sum reaches the high floor. One`,
		'closed before this lane yet recurring here is filed anew as a recurrence, its number in `--distinct`.',
		'A cap refusal is final: stop filing.',
	]
}

// The filing command: an overrun's filings name the lane they were found during; the baseline's name none.
function file_command(origin: number | undefined): string {
	if (origin === undefined) return 'pnpm josh issue:file'

	return `pnpm josh issue:file --found-during ${String(origin)}`
}

// Each lane pays a fixed review-to-merge cost, so causes one fix place shares are one issue. A fold
// skips `issue:file`, so it carries the ranked lines; the lane's minutes give it no label, and the
// fold applies the cause-loss floor with `issue:priority` (`issue-fold-existing.md`).
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
		"causes would cut — backlog ranking orders one priority by them, else by the lane's minutes, which every",
		'cause of the lane shares, so a filing without either falls behind every declared one.',
	].join(' ')
}

// A share over every merge thins a new mechanism's cost below any line (joshuafolkken/kit#4928), so the
// causes are picked by the minutes a fix would cut from what was read, largest first. `scope` names
// that span: one lane, or the baseline's merge.
function selection_lines(scope: string): ReadonlyArray<string> {
	const limit = `${String(MAX_FILINGS)} causes`

	return [
		`Estimate each cause's reducible minutes: what its fix would cut from ${scope}. Time the work`,
		'inherently takes (a CI wait the pipeline requires, a review) counts only for the part a fix removes,',
		'and not at all when no fix removes any.',
		`Take at most the ${limit} with the most reducible minutes, largest first, each cutting`,
		`${String(MIN_MINUTES)} minute or more, and drop the rest: file or fold only those.`,
		'File a defect — a tool did something unneeded or wrong (a rerun on an unchanged tree, a lost scope)',
		'— as `- 種別: 不具合`, any other cause as `- 目的: 時間短縮`.',
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
// lines each filing carries, the note its result is recorded as, and the span a cause's reducible
// minutes are cut from.
interface CauseHandling {
	origin: number | undefined
	loss_lines: string
	template: string
	scope: string
}

// The filing rules an investigation's causes follow, shared by the overrun and the baseline
// investigation (joshuafolkken/kit#4887).
function cause_handling(rules: CauseHandling): string {
	return [
		...selection_lines(rules.scope),
		grouping(rules.origin, rules.loss_lines),
		...duplicate_lines(rules.loss_lines),
		...result_lines(rules.template),
	].join(' ')
}

// The lines backlog ranking reads (joshuafolkken/kit#4861): the cause's own minutes, else the lane's
// `minutes`, cited to lane `issue`.
function loss_lines_of(issue: number, minutes: string): string {
	const cite = issue_cite.plain(issue)

	return `\`- 原因のレーン: ${minutes} 分（${cite}）\` and \`${issue_priority.CAUSE_PREFIX} <分> 分\``
}

// The breakdown the overrun's prompt leads with orders the search (joshuafolkken/kit#4995); a stage no
// fix shortens is named in the result, so the time no filing covers is still accounted for. Only the
// overrun has a breakdown: the baseline shares `cause_handling`, not this.
const STAGE_ORDER = [
	'Search for causes stage by stage, in the order of the net time by stage above, longest first.',
	`For each stage you judge not reducible, end the result with \`${run_event_overrun.NOT_REDUCIBLE_LEAD}<stage> (<why>)\`.`,
].join(' ')

// The handling of lane `issue`'s causes, its `minutes` of net time on each filing's ranked lines.
function handling(issue: number, minutes: number): string {
	const rules = cause_handling({
		origin: issue,
		loss_lines: loss_lines_of(issue, String(minutes)),
		template: run_event_overrun.ended_text(issue, '<result>'),
		scope: 'this lane alone, judged from its own record',
	})

	return `${STAGE_ORDER} ${rules}`
}

const lane_overrun_prompt = { cause_handling, handling, loss_lines_of }

export { lane_overrun_prompt }
