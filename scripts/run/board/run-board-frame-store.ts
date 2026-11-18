import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import { z } from 'zod'

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

function save(target: string, frame: RecordedFrame): void {
	try {
		stamp_file.replace_stamp(target, frame)
	} catch {
		// A failed write leaves no record, and the next answer reads from scratch.
	}
}

function file_store(root: string = PROJECT_ROOT): FrameStore {
	return {
		load: (key) => load(path_of(key, root)),
		save: (key, frame) => {
			save(path_of(key, root), frame)
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
// theme and each output keeps its own record.
function once_key(theme: string | undefined, is_tty: boolean): string {
	const output = is_tty ? 'tty' : 'pipe'

	return theme === undefined ? `${ONCE_KEY}-${output}` : `${ONCE_KEY}-${theme}-${output}`
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
	memory_store,
	once_key,
	path_of,
	recording,
	save_only,
}

export { run_board_frame_store }
export type { FrameStore, RecordedFrame }
