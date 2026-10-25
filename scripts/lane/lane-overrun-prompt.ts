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

// Each lane pays a fixed review-to-merge cost, so causes one fix place shares are one issue. A fold
// skips `issue:file`, so it carries the ranked lines; the lane's minutes give it no label.
function grouping(issue: number, loss_lines: string): string {
	return [
		'Causes whose fixes touch the same file or mechanism are one issue, an acceptance criterion per',
		'cause; causes fixed in different places are separate issues. Before filing one, look for an open',
		'issue that touches the same files (`pnpm josh issue:scout "<title>" --body-file <draft.md>`, each',
		'candidate read with `pnpm josh issue:read <N>`): when one does, fold its causes into it by',
		'`.claude/skills/workflow-commands/issue-fold-existing.md` instead of filing, the appended part',
		`carrying ${loss_lines}; on a verdict other than \`fold\`, file as below.`,
		'File each other issue with',
		`\`pnpm josh issue:file --found-during ${String(issue)}\`, its body carrying those four per cause, and`,
		`${loss_lines} under its background heading, the cause-loss minutes being what that issue's own`,
		"causes spent — backlog ranking orders one priority by them, else by the lane's minutes, which every",
		'cause of the lane shares, so a filing without either falls behind every declared one.',
	].join(' ')
}

// A filing's priority is the reduction it states, and `issue:file` refuses one under the high share,
// which would not pay back the lane its fix takes (joshuafolkken/kit#4870). Such a cause is still
// recorded, so a later investigation finding it again can count the recurrence.
function small_cause_lines(): ReadonlyArray<string> {
	const percent = `${String(issue_priority.HIGH_PERCENT)}%`

	return [
		`A cause whose fix saves under ${percent} of the median lane time per merge`,
		'(`- 1 マージあたりの短縮:`) is not filed — `issue:file` refuses it under `- 目的: 時間短縮`: fold it into an open issue as',
		`above, else end the result below with \` — under ${percent}: <cause, in a few words>\`. Before judging`,
		'a cause, count the earlier `overrun:` notes on the run events naming the same cause, and put that',
		'recurrence into its `効く率`.',
	]
}

function result_lines(issue: number): ReadonlyArray<string> {
	return [
		`Then record the result: \`pnpm josh run:event --append note "${run_event_overrun.ended_text(issue, '<result>')}"\`,`,
		`the result being \`${run_event_overrun.folded_result(['<A>', '<B>'])}\` naming every issue you folded into`,
		`when you folded any, else \`${run_event_overrun.FILED_RESULT}\` when you filed any, \`${run_event_overrun.recurred_result('<N>')}\``,
		`when you only commented a recurrence on #<N>, else \`${run_event_overrun.none_result('<why, in about 15 characters>')}\`.`,
	]
}

// The handling of lane `issue`'s causes, its `minutes` of net time on each filing's ranked lines.
function handling(issue: number, minutes: number): string {
	const cite = issue_cite.plain(issue)
	// The lines backlog ranking reads (joshuafolkken/kit#4861): the cause's own minutes, else the lane's.
	const loss_lines = `\`- 原因のレーン: ${String(minutes)} 分（${cite}）\` and \`${issue_priority.CAUSE_PREFIX} <分> 分\``

	return [
		grouping(issue, loss_lines),
		...small_cause_lines(),
		...duplicate_lines(loss_lines),
		...result_lines(issue),
	].join(' ')
}

const lane_overrun_prompt = { handling }

export { lane_overrun_prompt }
