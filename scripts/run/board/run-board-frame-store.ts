import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import { z } from 'zod'
import { run_board_icons, type Icons } from './run-board-icons'
import type { Theme } from './run-board-theme-defs'

// The last frame `run:board --chat` and `--once` drew, kept per checkout and per form in `/tmp`, so a
// progress question asked again within a minute is answered from it without reading anything — a read
// from scratch takes tens of seconds. A record that cannot be read is no record: the board reads.

const FRAME_PREFIX = 'josh-run-board-frame-'
const FRESH_MS = MS_PER_MINUTE
const CHAT_KEY = 'chat'
const ONCE_KEY = 'once'

interface RecordedFrame {
	text: string
	saved_ms: number
}

interface FrameStore {
	load: (key: string) => RecordedFrame | undefined
	save: (key: string, frame: RecordedFrame) => void
}

const frame_schema = z.object({ text: z.string(), saved_ms: z.number() })

function frame_of(text: string): RecordedFrame | undefined {
	try {
		const parsed = frame_schema.safeParse(JSON.parse(text))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

function path_of(key: string, root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(`${FRAME_PREFIX}${key}-`, root)
}

function load(target: string): RecordedFrame | undefined {
	const text = stamp_file.read_stamp_text(target)

	return text === undefined ? undefined : frame_of(text)
}

async function save(target: string, frame: RecordedFrame): Promise<void> {
	try {
		await stamp_file.replace_stamp_async(target, frame)
	} catch {
		// A failed write leaves no record, and the next answer reads from scratch.
	}
}

interface LatestWriter {
	save: (frame: RecordedFrame) => void
	settled: () => Promise<void>
}

// The frame waiting for the write in flight, and that write's drain while one runs.
interface WriterSlot {
	waiting: RecordedFrame | undefined
	draining: Promise<void> | undefined
}

// One key's writes, one at a time and never awaited by the saver: a frame saved while one is being
// written replaces any still waiting, so the last frame saved is the last one written and no older
// write lands over it.
function latest_writer(write: (frame: RecordedFrame) => Promise<void>): LatestWriter {
	const slot: WriterSlot = { waiting: undefined, draining: undefined }

	async function drain(): Promise<void> {
		const frame = slot.waiting

		if (frame === undefined) {
			slot.draining = undefined

			return
		}

		slot.waiting = undefined
		await write(frame)
		await drain()
	}

	return {
		save: (frame) => {
			slot.waiting = frame
			slot.draining ??= drain()
		},
		settled: async () => {
			await slot.draining
		},
	}
}

// The file store's writes run off the caller's path; `settled` waits for every one started so far.
interface FileFrameStore extends FrameStore {
	settled: () => Promise<void>
}

function file_store(root: string = PROJECT_ROOT): FileFrameStore {
	const writers = new Map<string, LatestWriter>()

	function writer_of(key: string): LatestWriter {
		const writer =
			writers.get(key) ??
			latest_writer(async (frame) => {
				await save(path_of(key, root), frame)
			})

		writers.set(key, writer)

		return writer
	}

	return {
		load: (key) => load(path_of(key, root)),
		save: (key, frame) => {
			writer_of(key).save(frame)
		},
		settled: async () => {
			await Promise.all(
				[...writers.values()].map(async (writer) => {
					await writer.settled()
				}),
			)
		},
	}
}

function memory_store(): FrameStore {
	const kept = new Map<string, RecordedFrame>()

	return {
		load: (key) => kept.get(key),
		save: (key, frame) => {
			kept.set(key, frame)
		},
	}
}

function no_record(): RecordedFrame | undefined {
	return undefined
}

// The store that saves but loads nothing, so the next answer reads from scratch and is still recorded.
function save_only(store: FrameStore | undefined): FrameStore | undefined {
	if (store === undefined) return undefined

	return { load: no_record, save: store.save }
}

// A still frame in a theme is drawn in its own colors, and one on a terminal carries its links, so each
// theme and each output keeps its own record; icons other than the theme's default keep theirs too
// (joshuafolkken/kit#8505).
function once_key(theme: Theme | undefined, is_tty: boolean, icons?: Icons): string {
	const output = is_tty ? 'tty' : 'pipe'
	const drawn = icons === run_board_icons.default_of(theme) ? undefined : icons

	return [ONCE_KEY, theme, drawn, output].filter((part) => part !== undefined).join('-')
}

function is_fresh(age_ms: number): boolean {
	return age_ms >= 0 && age_ms <= FRESH_MS
}

// The recorded frame with a line saying how old it is, while it is at most a minute old; else none.
function fresh(store: FrameStore | undefined, key: string, now_ms: number): string | undefined {
	const frame = store?.load(key)

	if (frame === undefined || !is_fresh(now_ms - frame.saved_ms)) return undefined
	const seconds = Math.floor((now_ms - frame.saved_ms) / MS_PER_SECOND)

	return `${frame.text}recorded ${String(seconds)}s ago\n`
}

// A write that also records what it wrote, dated when its read began so the age is never understated.
function recording(
	write: (frame: string) => void,
	store: FrameStore | undefined,
	key: string,
	saved_ms: number,
): (frame: string) => void {
	return (frame) => {
		write(frame)
		store?.save(key, { text: frame, saved_ms })
	}
}

const run_board_frame_store = {
	CHAT_KEY,
	FRESH_MS,
	file_store,
	fresh,
	latest_writer,
	memory_store,
	once_key,
	path_of,
	recording,
	save_only,
}

export { run_board_frame_store }
export type { FileFrameStore, FrameStore, RecordedFrame }
