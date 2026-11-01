import { time_format } from '#scripts/time-runtime/time-format'

// The one line a lint run prints of where its seconds went: each tool's own, since the two run side by
// side and the step's seconds name neither as the long pole (joshuafolkken/kit#5116), then the facts a
// slow run is diagnosed by (joshuafolkken/kit#5712). `lane:breakdown` reads the line back out of the
// call's transcript output, so the printer and the reader share this one shape.

const MARK = ' timing — '
const SEPARATOR = ' · '

interface LintTiming {
	label: string
	prettier_ms: number
	eslint_ms: number
	facts: ReadonlyArray<string>
}

function line(timing: LintTiming): string {
	const tools = [
		`prettier ${time_format.format_seconds(timing.prettier_ms)}`,
		`eslint ${time_format.format_seconds(timing.eslint_ms)}`,
	]

	return `${timing.label}${MARK}${[...tools, ...timing.facts].join(SEPARATOR)}\n`
}

// What `label`'s timing line in `output` says past its mark, `undefined` when the run printed none.
function detail_of(label: string, output: string): string | undefined {
	const prefix = `${label}${MARK}`

	return output
		.split('\n')
		.find((text) => text.startsWith(prefix))
		?.slice(prefix.length)
}

const lint_timing = { detail_of, line }

export { lint_timing }
