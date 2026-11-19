import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { deserialize, serialize } from 'node:v8'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'
import { run_board_span_read } from './run-board-span-read'
import type { BoardGather } from './run-board-state'

// The last round a live board's worker handed over, kept in one file per checkout, so the next board
// on the same run draws it the moment its screen opens rather than after the worker's first round
// (joshuafolkken/kit#8219). The frames `--chat` and `--once` answer from (`run-board-frame-store.ts`)
// are finished text; this is the round itself, so the board redraws it at its own size and dims the
// plan it carries until a fresh one lands. It is written the way the worker posts it — a structured
// clone, Maps and Sets kept — and is missing, unreadable or malformed means none; a write that fails is
// dropped.

const SAVED_PREFIX = 'josh-run-board-saved-'
const SAVE_EVERY_SECONDS = 5
const SAVE_EVERY_MS = SAVE_EVERY_SECONDS * MS_PER_SECOND
const TEMPORARY_SUFFIX = '.writing'

interface Saved {
	run_started_ms: number
	saved_ms: number
	gather: BoardGather
}

interface SavedStore {
	load: () => Saved | undefined
	save: (saved: Saved) => void
}

function is_gather(value: unknown): value is BoardGather {
	return typeof value === 'object' && value !== null && 'data' in value && 'display' in value
}

const saved_schema = z.object({
	run_started_ms: z.number(),
	saved_ms: z.number(),
	gather: z.custom<BoardGather>(is_gather),
})

function load(target: string): Saved | undefined {
	try {
		const parsed = saved_schema.safeParse(deserialize(readFileSync(target)))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// Written beside the file, then moved over it, so a board never reads half a write.
function save(target: string, saved: Saved): void {
	const writing = `${target}${TEMPORARY_SUFFIX}`

	try {
		writeFileSync(writing, serialize(saved))
		renameSync(writing, target)
	} catch {
		// The next round writes it again.
	}
}

function file_store(
	target: string = stamp_file.stamp_path(SAVED_PREFIX, PROJECT_ROOT),
): SavedStore {
	return {
		load: () => load(target),
		save: (saved) => {
			save(target, saved)
		},
	}
}

// What the worker calls with each round it hands over: one with the run's data saved at most every
// `SAVE_EVERY_MS`.
function saver(store: SavedStore, now: () => number): (gather: BoardGather) => void {
	let saved_ms = -Infinity

	return (gather) => {
		const run_started_ms = gather.data?.run_started_ms
		const now_ms = now()

		if (run_started_ms === undefined || now_ms - saved_ms < SAVE_EVERY_MS) return
		saved_ms = now_ms
		store.save({ run_started_ms, saved_ms: now_ms, gather })
	}
}

// The run drawn here, read without the process table, which the worker's first round takes;
// it reads the repository the worker's local read reads (run-board-read.ts).
async function started_here(): Promise<number | undefined> {
	const repository = await run_carry.repository_directory()
	const { span } = await run_board_span_read.span_here(repository, undefined)

	return span?.started_ms
}

// The saved round when it was saved on the run drawn here, else none — a round of another run is never
// drawn over this one. Its plan read is asked again at once, so the saved plan is drawn dimmed only
// until a fresh one lands.
async function for_run(
	store: SavedStore,
	started: () => Promise<number | undefined> = started_here,
): Promise<BoardGather | undefined> {
	const saved = store.load()
	if (saved === undefined || saved.run_started_ms !== (await started())) return undefined

	const { gather } = saved
	const data = gather.data === undefined ? undefined : { ...gather.data, attempted_ms: undefined }

	return { ...gather, data }
}

const run_board_saved_state = { SAVE_EVERY_MS, file_store, for_run, saver }

export { run_board_saved_state }
export type { Saved, SavedStore }
