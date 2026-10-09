import { readFileSync } from 'node:fs'
import { review_diff_parts } from '#scripts/review/review-diff-parts'
import { capped_print_part } from './capped-print-part'

// Reads a `capped_print` result back into the text it stands for, so a test can pin both halves of
// the contract: what was printed fits under the cap, and nothing was lost.

const PART_LINE_PREFIX = '  '
const LINE_BREAK = '\n'

function part_files(printed: string): Array<string> {
	return printed
		.split(LINE_BREAK)
		.filter((line) => line.startsWith(PART_LINE_PREFIX))
		.map((line) => line.slice(PART_LINE_PREFIX.length))
		.filter((file) => capped_print_part.is_part_file(file))
}

// The printed text itself when it was printed whole, the concatenated part bodies when it was not.
function restored(printed: string): string {
	const files = part_files(printed)

	if (files.length === 0) return printed

	return files.map((file) => review_diff_parts.body_of(readFileSync(file, 'utf8'))).join('')
}

function largest_read(printed: string): number {
	const files = part_files(printed)

	return Math.max(printed.length, ...files.map((file) => readFileSync(file, 'utf8').length))
}

const capped_print_fixture = { largest_read, part_files, restored }

export { capped_print_fixture }
