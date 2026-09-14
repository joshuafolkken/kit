import { describe, expect, it } from 'vitest'
import { time_writes } from './time-writes'

// joshuafolkken/kit#1472: a span keeps no tool input, so what a call wrote has to be read while the
// input is still in hand. What the cases below pin is the boundary between writing and reading —
// over-claiming here silently removes a genuine pending read from the investigation count.

const FILE = 'scripts/one.ts'
const NOTEBOOK = 'notes/one.ipynb'

describe('time_writes.tool_writes — what a non-Bash call wrote', () => {
	// `Edit` and `Write` already subtracted through `targets`; `MultiEdit` and `NotebookEdit` are the
	// two that carry the edit marker while sitting outside `BUNDLEABLE_TOOLS`, so they arrived naming
	// nothing at all.
	it.each(['Edit', 'Write', 'MultiEdit'])('names the file %s wrote', (name) => {
		expect(time_writes.tool_writes(name, { file_path: FILE })).toEqual([FILE])
	})

	it('names the notebook NotebookEdit wrote', () => {
		expect(time_writes.tool_writes('NotebookEdit', { notebook_path: NOTEBOOK })).toEqual([NOTEBOOK])
	})

	it.each(['Read', 'Grep', 'Glob'])('claims nothing for %s, which writes nothing', (name) => {
		expect(time_writes.tool_writes(name, { file_path: FILE })).toEqual([])
	})
})

describe('time_writes.bash_writes — what a shell line wrote', () => {
	// `sed -n` is this repository's main reading command and `sed -i` its allowed small edit; the span
	// labels both `Bash: sed`, which is the whole reason this module exists.
	it.each(["sed -i '' 's/old/new/'", 'sed -i.bak s/old/new/', 'sed --in-place s/old/new/'])(
		'names the file %s wrote in place',
		(head) => {
			expect(time_writes.bash_writes(`${head} ${FILE}`)).toContain(FILE)
		},
	)

	it.each(["sed -n '1,40p'", 'sed -E s/old/new/'])('claims nothing for the read %s', (head) => {
		expect(time_writes.bash_writes(`${head} ${FILE}`)).toEqual([])
	})

	// Only the segment that runs the command is scanned. Whole-line, `grep`'s own `-i` would make a
	// pure read look like a write, and the file would be deleted from a count it belongs in.
	it('ignores an -i belonging to a later pipeline segment', () => {
		expect(time_writes.bash_writes(`sed -n '1,40p' ${FILE} | grep -i thing`)).toEqual([])
	})

	// The quoted script is removed before targets are read, or both sides of a path substitution are
	// claimed as files the command wrote.
	it('claims the operand of a path substitution and not its script', () => {
		const command = `sed -i '' 's|${FILE}|scripts/two.ts|g' docs/index.md`

		expect(time_writes.bash_writes(command)).toEqual(['docs/index.md'])
	})

	// The leading command is read the way the span's own label is read, so a `cd` in front of the
	// write does not hide it — that form is how every command in a lane is typed.
	it('sees an in-place write behind a directory change', () => {
		expect(time_writes.bash_writes(`cd /tmp/x && sed -i '' s/a/b/ ${FILE}`)).toContain(FILE)
	})

	// A `>` redirection and a heredoc write too, but the same line names what it read — and this set is
	// subtracted, so claiming those would delete a pending read that really is pending.
	it('claims nothing for a command that is not an in-place sed', () => {
		expect(time_writes.bash_writes(`cat ${FILE} > other.ts`)).toEqual([])
	})
})
