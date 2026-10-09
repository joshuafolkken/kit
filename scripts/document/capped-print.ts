import { mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { review_diff_parts } from '#scripts/review/review-diff-parts'
import { bash_output_cap_reader } from './bash-output-cap'
import { capped_print_part } from './capped-print-part'

// Prints a command's output whole when it fits under the Bash output cap, and as part files when it
// does not. Past `BASH_MAX_OUTPUT_LENGTH` Claude Code saves the output and
// hands back a 2 KB preview, and the run spends a turn reading the saved file — 224 overflows and 132
// re-reads over one day's sessions, `doc:section` and `issue:read` the two most frequent `josh` sources.
//
// **The cut is #2963's, not a second one.** The parts come from `review_diff_parts.part_texts`, so each
// file — header included — fits under the cap and the bodies concatenate back to exactly the output.
// A reader opens them all with the Read tool in one turn, which is the turn the preview used to cost.
//
// **A fresh directory per call**, unlike the review's per-checkout one: a run fetches several sections
// in one turn, and a shared directory replaced on every call would delete one call's parts while
// another call's listing still names them.

const FILE_MODE = 0o600
const LINE_BREAK = '\n'
// What else shares the Bash result with this output: the launcher line, a script banner, a few
// stderr lines. Measured at about 80 characters for `pnpm josh doc:section` in kit, so 512 holds the
// longest heading or issue list with room for a consumer's banner.
const HEADROOM_CHARS = 512

function write_parts(label: string, text: string, cap: number): Array<string> {
	const directory = mkdtempSync(path.join(PLATFORM_TEMP_ROOT, capped_print_part.DIRECTORY_PREFIX))

	return review_diff_parts.part_texts(label, text, cap).map((part, index) => {
		const file = path.join(directory, capped_print_part.part_name(index))

		writeFileSync(file, part, { flag: 'wx', mode: FILE_MODE })

		return file
	})
}

function part_count(count: number): string {
	return `written as ${String(count)} part file${count === 1 ? '' : 's'} under it`
}

function listing(text: string, cap: number, files: ReadonlyArray<string>): string {
	const figures = `${text.length.toLocaleString('en-US')} > ${cap.toLocaleString('en-US')} characters`
	const lead = `Over the Bash cap (${figures}) — ${part_count(files.length)}, together exactly the output. Read every part with the Read tool, in one turn, not cat:`

	return [lead, ...files.map((file) => `  ${file}`)].join(LINE_BREAK)
}

// **The budget is the cap less a headroom, not the cap.** The Bash result carries more than this
// output — `pnpm josh`'s own launcher line, a consumer's script banner, the stderr lines naming a
// number that did not resolve — so a text measured against the bare cap would overflow by exactly
// those lines, and cost the re-read this module exists to remove.
function output_budget(root: string): number {
	return Math.max(1, bash_output_cap_reader.bash_output_cap(root) - HEADROOM_CHARS)
}

function capped_print(text: string, label: string, root: string = process.cwd()): void {
	const budget = output_budget(root)

	if (text.length < budget) {
		console.info(text)

		return
	}

	console.info(listing(text, budget, write_parts(label, text, budget)))
}

const capped_output = { HEADROOM_CHARS, capped_print }

export { capped_output }
