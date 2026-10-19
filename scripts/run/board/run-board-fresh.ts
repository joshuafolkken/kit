import { styleText } from 'node:util'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'

// **The one place a freshly updated part of `run:board` is emphasized** — the header's `💓` and third
// line, an issue row's phase, start and end (joshuafolkken/kit#3784). The emphasis fades in three
// one-second stages, decided by the part's age alone, so no frame remembers the one before it. Only a
// live screen draws it: a chat, a `--once` frame or a pipe gets the text as it is.

type FreshStage = 'inverse' | 'bold-color' | 'bold' | 'none'

type TextFormat = Parameters<typeof styleText>[0]

// What decides whether a frame emphasizes at all: a screen frame with a spinner is a live terminal.
interface FreshFrame {
	now_ms: number
	form: 'screen' | 'chat'
	spinner: string | undefined
}

const STAGE_MS = MS_PER_SECOND
const FADING: ReadonlyArray<FreshStage> = ['inverse', 'bold-color', 'bold']
const FORMATS: Readonly<Record<Exclude<FreshStage, 'none'>, TextFormat>> = {
	inverse: 'inverse',
	'bold-color': ['bold', 'cyan'],
	bold: 'bold',
}

// The stage a part `age_ms` old is drawn in; an unknown or a future age is never emphasized.
function stage_of(age_ms: number | undefined): FreshStage {
	if (age_ms === undefined || age_ms < 0) return 'none'

	return FADING[Math.floor(age_ms / STAGE_MS)] ?? 'none'
}

function paint(text: string, stage: FreshStage): string {
	if (stage === 'none' || text === '') return text

	return styleText(FORMATS[stage], text)
}

function is_live(frame: FreshFrame): boolean {
	return frame.form === 'screen' && frame.spinner !== undefined
}

// `text` emphasized as a part `age_ms` old, where the frame is a live screen.
function aged(text: string, age_ms: number | undefined, frame: FreshFrame): string {
	return is_live(frame) ? paint(text, stage_of(age_ms)) : text
}

// `text` emphasized as a part that changed at `at_ms`.
function since(text: string, at_ms: number | undefined, frame: FreshFrame): string {
	return aged(text, at_ms === undefined ? undefined : frame.now_ms - at_ms, frame)
}

// `text` right-aligned to `width` with only the text emphasized, never the blanks before it, so the
// column keeps its width and an inverse stage does not light up the padding.
function padded(text: string, width: number, emphasized: string): string {
	return `${' '.repeat(Math.max(0, width - text.length))}${emphasized}`
}

const run_board_fresh = { aged, padded, paint, since, stage_of }

export { run_board_fresh }
export type { FreshFrame, FreshStage }
