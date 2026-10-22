import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import type { ClosedIssue } from './run-board-closed'

// The last GitHub reads a `run:board` drew — the titles, the labels and the children read closed — kept
// in one file per checkout, so a board opened again draws them at once rather than nameless until its
// first read lands. A snapshot holds for the run it was written in; a board on another run discards it.
// The board never stops on it: a snapshot that is missing, unreadable or malformed is no snapshot, and a
// write that fails is dropped.

const SNAPSHOT_PREFIX = 'josh-run-board-snapshot-'

// The titles and labels the board names each issue's row by.
interface Known {
	titles: ReadonlyMap<number, string>
	labels: ReadonlyMap<number, ReadonlyArray<string>>
}

interface Snapshot extends Known {
	run_started_ms: number
	closed: ReadonlyMap<number, ClosedIssue>
}

// Where a board keeps its snapshot; a board with none keeps nothing.
interface SnapshotStore {
	load: () => Snapshot | undefined
	save: (snapshot: Snapshot) => void
}

const NO_KNOWN: Known = { titles: new Map(), labels: new Map() }

const label_names_schema = z.array(z.string())

// A close time JSON dropped is read back as unknown.
const closed_issue_schema = z
	.object({
		title: z.string(),
		labels: label_names_schema,
		closed_ms: z.number().optional(),
		is_merged: z.boolean(),
		is_not_planned: z.boolean(),
	})
	.transform((view): ClosedIssue => ({ ...view, closed_ms: view.closed_ms }))

const title_entry_schema = z.tuple([z.number(), z.string()])
const label_entry_schema = z.tuple([z.number(), label_names_schema])
const closed_entry_schema = z.tuple([z.number(), closed_issue_schema])

const snapshot_schema = z.object({
	run_started_ms: z.number(),
	titles: z.array(title_entry_schema),
	labels: z.array(label_entry_schema),
	closed: z.array(closed_entry_schema),
})

function snapshot_of(text: string): Snapshot | undefined {
	try {
		const parsed = snapshot_schema.safeParse(JSON.parse(text))

		if (!parsed.success) return undefined

		const { run_started_ms, titles, labels, closed } = parsed.data

		return {
			run_started_ms,
			titles: new Map(titles),
			labels: new Map(labels),
			closed: new Map(closed),
		}
	} catch {
		return undefined
	}
}

function load(target: string): Snapshot | undefined {
	const text = stamp_file.read_stamp_text(target)

	return text === undefined ? undefined : snapshot_of(text)
}

function save(target: string, snapshot: Snapshot): void {
	const payload = {
		run_started_ms: snapshot.run_started_ms,
		titles: [...snapshot.titles],
		labels: [...snapshot.labels],
		closed: [...snapshot.closed],
	}

	try {
		stamp_file.replace_stamp(target, payload)
	} catch {
		// The next landed read writes it again.
	}
}

function file_store(
	target: string = stamp_file.stamp_path(SNAPSHOT_PREFIX, PROJECT_ROOT),
): SnapshotStore {
	return {
		load: () => load(target),
		save: (snapshot) => {
			save(target, snapshot)
		},
	}
}

const run_board_snapshot = { NO_KNOWN, file_store }

export { run_board_snapshot }
export type { Known, Snapshot, SnapshotStore }
