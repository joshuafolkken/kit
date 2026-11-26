import { readFileSync } from 'node:fs'
import { deserialize, serialize } from 'node:v8'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'
import type { FailedPost, GatherPost } from './run-board-gather-thread'
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

// The machine samples a round lands after its lane read, so an early post has none of them yet.
type Sample = 'gauges' | 'usages' | 'quotas'

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

// Read only from this account's own regular file, as every shared temp-directory record is
// (`stamp-file.ts`).
function load(target: string): Saved | undefined {
	try {
		if (!stamp_file.is_own_regular_file(target)) return undefined
		const parsed = saved_schema.safeParse(deserialize(readFileSync(target)))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// Staged beside the file and moved over it, so a board never reads half a write (`stamp-file.ts`).
function save(target: string, saved: Saved): void {
	try {
		stamp_file.replace_text_stamp(target, serialize(saved))
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

function samples_of(gather: BoardGather, last: BoardGather): Pick<BoardGather, Sample> {
	return {
		gauges: gather.gauges ?? last.gauges,
		usages: gather.usages ?? last.usages,
		quotas: gather.quotas ?? last.quotas,
	}
}

// The round a post carries, its samples not yet in (a new worker's early post) taken from the round
// last saved on the same run, so a board quit within `SAVE_EVERY_MS` of opening leaves the next one
// a complete round to draw (joshuafolkken/kit#8957).
function gather_of(post: GatherPost, kept: Saved | undefined, run_started_ms: number): BoardGather {
	const gather = { ...post.read, data: post.data, display: post.display }

	if (kept?.run_started_ms !== run_started_ms) return gather

	return { ...gather, ...samples_of(gather, kept.gather) }
}

// What the worker calls with each post it hands over: a round with the run's data saved at most every
// `SAVE_EVERY_MS`, a failed round never.
function saver(store: SavedStore, now: () => number): (post: GatherPost | FailedPost) => void {
	let saved_ms = -Infinity
	let kept = store.load()

	return (post) => {
		if ('failed' in post) return
		const run_started_ms = post.data?.run_started_ms
		const now_ms = now()

		if (run_started_ms === undefined || now_ms - saved_ms < SAVE_EVERY_MS) return
		saved_ms = now_ms
		kept = { run_started_ms, saved_ms: now_ms, gather: gather_of(post, kept, run_started_ms) }
		store.save(kept)
	}
}

// The run drawn here, read without the process table, which the worker's first round takes;
// it reads the repository the worker's local read reads (run-board-read.ts).
async function started_here(): Promise<number | undefined> {
	const repository = await run_carry.repository_directory()
	const { span } = await run_board_span_read.span_here(repository, undefined)

	return span?.started_ms
}

// A run check that fails reads as another run, so the board waits for the worker as it did before.
async function started_safely(
	started: () => Promise<number | undefined>,
): Promise<number | undefined> {
	try {
		return await started()
	} catch {
		return undefined
	}
}

// The saved round as a board opening now draws it: its plan read asked again at once, so the saved
// plan is drawn dimmed only until a fresh one lands, and without the cue the last board already sounded.
// The sound it carried is kept, so what changed since that board sounds once on this one.
function reopened(gather: BoardGather): BoardGather {
	const data = gather.data === undefined ? undefined : { ...gather.data, attempted_ms: undefined }
	const display = gather.display === undefined ? undefined : { ...gather.display, cue: undefined }

	return { ...gather, data, display }
}

// The saved round when it was saved on the run drawn here, else none — a round of another run is never
// drawn over this one.
async function for_run(
	store: SavedStore,
	started: () => Promise<number | undefined> = started_here,
): Promise<BoardGather | undefined> {
	const saved = store.load()

	if (saved === undefined || saved.run_started_ms !== (await started_safely(started))) {
		return undefined
	}

	return reopened(saved.gather)
}

const run_board_saved_state = { SAVE_EVERY_MS, file_store, for_run, saver }

export { run_board_saved_state }
export type { Saved, SavedStore }
