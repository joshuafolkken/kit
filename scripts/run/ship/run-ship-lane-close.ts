import path from 'node:path'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_merged } from '#scripts/issue/issue-merged'
import { lane_close, type CloseOutcome } from '#scripts/lane/lane-close'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { error_text } from '#scripts/lib/error-message'
import type { Outcome } from '#scripts/run/tidy/run-tidy'
import { run_tidy_stashes } from '#scripts/run/tidy/run-tidy-stashes'

// The lane a merged ship ran from, closed by the ship's detached supervisor once the result is
// recorded — the one owner every launch path shares, since every lane child ships detached. The
// supervisor runs from the lane, so it steps out to the main checkout before the lane goes, and only
// a lane holding nothing a close cannot give back is closed. The issue's stashes go with it.

interface LaneCloseProbes {
	find_lane: (issue: string) => Promise<LaneInfo | undefined>
	cwd: () => string
	kept_reason: (lane: LaneInfo) => Promise<string | undefined>
	main_root: () => Promise<string>
	chdir: (directory: string) => void
	close: (issue: string) => Promise<CloseOutcome>
	tidy_stashes: (issue: string) => Promise<Array<Outcome>>
	print: (line: string) => void
}

const LIVE_PROBES: LaneCloseProbes = {
	find_lane: async (issue) => lane_registry.find_lane(await lane_registry.list_lanes(), issue),
	cwd: () => process.cwd(),
	kept_reason: async (lane) => await lane_spent.merged_kept_reason(lane),
	main_root: async () => await lane_registry.main_repository_root(),
	chdir: (directory) => {
		process.chdir(directory)
	},
	close: async (issue) => await lane_close.close_lane(issue),
	tidy_stashes: async (issue) =>
		await run_tidy_stashes.tidy_issue_stashes(issue, issue_merged.read_merged),
	print: (line) => {
		console.info(line)
	},
}

function is_inside(directory: string, cwd: string): boolean {
	const relative = path.relative(directory, cwd)

	return !relative.startsWith('..') && !path.isAbsolute(relative)
}

// The lane this supervisor runs from — none for a ship typed in the main checkout or another lane.
async function own_lane(issue: string, probes: LaneCloseProbes): Promise<LaneInfo | undefined> {
	const lane = await probes.find_lane(issue)

	return lane !== undefined && is_inside(lane.directory, probes.cwd()) ? lane : undefined
}

// The supervisor's log is read in a terminal, unlinked.
function lane_label(issue: string): string {
	return `lane ${issue_cite.plain_for('terminal', issue)}`
}

function close_line(outcome: CloseOutcome): string {
	const residue =
		outcome.left_behind.length === 0 ? '' : `; left behind: ${outcome.left_behind.join(', ')}`

	return `${lane_label(outcome.issue)} ${outcome.kind}${residue}`
}

function stash_line(outcome: Outcome): string {
	const { verdict } = outcome

	return verdict.kind === 'keep'
		? `kept ${outcome.target}: ${verdict.reason}`
		: `dropped ${outcome.target}`
}

async function close_spent(lane: LaneInfo, probes: LaneCloseProbes): Promise<void> {
	probes.chdir(await probes.main_root())
	probes.print(close_line(await probes.close(lane.issue)))

	const stashes = await probes.tidy_stashes(lane.issue)

	for (const outcome of stashes) probes.print(stash_line(outcome))
}

async function close_own_lane(issue: string, probes: LaneCloseProbes): Promise<void> {
	const lane = await own_lane(issue, probes)

	if (lane === undefined) return

	const reason = await probes.kept_reason(lane)

	if (reason === undefined) await close_spent(lane, probes)
	else probes.print(`${lane_label(issue)} kept: ${reason}`)
}

// A failure here comes after the result is recorded, so it is reported and never fails the ship.
async function close_merged(issue: string, probes: LaneCloseProbes = LIVE_PROBES): Promise<void> {
	try {
		await close_own_lane(issue, probes)
	} catch (error) {
		probes.print(`${lane_label(issue)} not closed: ${error_text.message_of(error)}`)
	}
}

const run_ship_lane_close = { close_merged }

export type { LaneCloseProbes }
export { run_ship_lane_close }
