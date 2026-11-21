import { styleText } from 'node:util'

// A line drawn faint, for the rows a saved plan drew until a fresh plan lands (joshuafolkken/kit#8219).
// A bold or a full reset inside the line ends faint too, so faint is opened again after each. The codes
// are the ones `styleText` gives, so a stream with no color gets none, and the line comes back as it was.

interface Pair {
	open: string
	close: string
}

const PROBE = '\u{0}'
// A full reset (`0`, or none) and the bold/faint close (`22`).
// eslint-disable-next-line no-control-regex -- the escapes that end faint are control characters
const ENDS_FAINT = /\u{1B}\[(?:0|22)?m/gu

function dim_pair(): Pair {
	const [open = '', close = ''] = styleText('dim', PROBE).split(PROBE)

	return { open, close }
}

function faint_in(line: string, pair: Pair): string {
	const { open, close } = pair
	if (open === '') return line

	const reopened = line.replaceAll(ENDS_FAINT, (end) => end + open)

	return `${open}${reopened}${close}`
}

function faint(line: string): string {
	return faint_in(line, dim_pair())
}

const run_board_faint = { faint, faint_in }

export { run_board_faint }
