import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_finding_ledger } from './review-finding-ledger'
import { review_fix_round, type RecordedRound } from './review-fix-round'
import { review_readers_scan } from './review-readers-scan'
import { review_round_one_blobs } from './review-round-one-blobs'

const LOCATION = /^(?<path>.+):(?<start>\d+)(?:-(?<end>\d+))?$/u
const RESUMED_HEADING =
	'Resumed round 1 — a review of this branch was already attested, so this pass reads only what changed since the tree it read.'

function resumed_block(input: {
	recorded_at: string | undefined
	paths: string
	reconciliation: ReadonlyArray<string>
	fallback: string
}): string {
	if (input.recorded_at === undefined || input.paths === '') return input.fallback

	return [
		RESUMED_HEADING,
		`The attested review read the tree recorded at ${input.recorded_at}.`,
		`Target: only these files, which changed since that tree:\n${input.paths}`,
		...input.reconciliation,
		'Review these files in full against the rubric — they are the only code this pass has not already read.',
	].join('\n')
}

function covers(start: string, end: string | undefined, line: number): boolean {
	return line >= Number(start) && line <= Number(end ?? start)
}

// Read the reverse delta so the existing new-side line reader gives the finding's ORIGINAL lines.
function cited(finding: RecordedRound['findings'][number], file: string, line: number): boolean {
	const groups = LOCATION.exec(finding.file)?.groups

	if (groups?.['path'] !== file) return false

	return covers(groups['start'] ?? '', groups['end'], line)
}

function is_blob(value: string | undefined): value is string {
	return value !== undefined && /^[a-f\d]{40,64}$/u.test(value)
}

function blob_diff(
	old: string | undefined,
	now: string | undefined,
	root: string,
): string | undefined {
	if (!is_blob(old) || !is_blob(now)) return undefined

	return git_spawn_sync.read(['diff', '--no-ext-diff', '--no-textconv', '-U0', old, now], {
		cwd: root,
	})
}

function is_uncited(lines: ReadonlyArray<number>, round: RecordedRound, file: string): boolean {
	return (
		lines.length === 0 ||
		round.findings.some((finding) => finding.description.length === 0) ||
		lines.some((line) => round.findings.every((finding) => !cited(finding, file, line)))
	)
}

function path_delta(input: {
	file: string
	stamp: FileMapStamp
	now: Record<string, string>
	round: RecordedRound
	root: string
}): string | undefined {
	const { file, stamp, now, round, root } = input
	const old = stamp.blobs?.[file]
	const reverse = blob_diff(now[file], old, root)
	const lines = reverse === undefined ? [] : review_readers_scan.changed_lines(reverse)

	if (is_uncited(lines, round, file)) return undefined

	const diff = blob_diff(old, now[file], root)

	return diff === undefined ? undefined : `${file}\n${diff}`
}

function block(
	round: RecordedRound,
	paths: ReadonlyArray<string>,
	root: string,
): string | undefined {
	const stamp = review_fix_round.snapshot(round)
	const now = review_round_one_blobs.capture(paths)

	if (stamp === undefined || now === undefined || paths.length === 0) return undefined

	const diffs = paths.map((file) => path_delta({ file, stamp, now, round, root }))

	if (diffs.includes(undefined)) return undefined

	return [
		'Round 1 rerun — review only the fix hunks below and the open findings; check the fixes for new defects.',
		`Previous round: ${round.id}`,
		...diffs,
		'Open findings (locations refer to the previous review):',
		...round.findings
			.filter((finding) => !review_finding_ledger.is_closing(finding.disposition))
			.map(
				(finding) =>
					`${finding.category}:${finding.severity}:${finding.file} — ${finding.description}`,
			),
	].join('\n')
}

const review_fix_hunks = { block, resumed_block, RESUMED_HEADING }

export { review_fix_hunks }
