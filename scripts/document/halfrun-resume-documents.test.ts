import { describe, expect, it } from 'vitest'
import { read_document } from './ai-document-fixture'

// What a reader is told to do after a `halfrun` stop (joshuafolkken/kit#3600). The stop notification
// leads with `Next: prrun #<N> | fullrun #<N>` and `run:entry` adopts the stopped run from the gate,
// so a page that offers the commit command has to offer the two keywords beside it.
const RESUME_DOCUMENTS: ReadonlyArray<string> = ['docs/tutorial.md', 'docs/how-to/recover-a-run.md']
const RESUME_KEYWORDS: ReadonlyArray<string> = ['fullrun #N', 'prrun #N']
const COMMIT_COMMAND = 'commit command'
const RESUME_POINT = 'from the gate'
const REFUSED_START = 'will not start'

function lines_naming(path: string, marker: string): Array<string> {
	return read_document(path)
		.split('\n')
		.filter((line) => line.includes(marker))
}

function commit_command_lines(path: string): Array<string> {
	return lines_naming(path, COMMIT_COMMAND)
}

// The lines that state the resume itself. Without them a page could name the keywords only as what
// the commit command replaces and still pass the check below.
function resume_lines(path: string): Array<string> {
	return lines_naming(path, RESUME_POINT).filter((line) =>
		RESUME_KEYWORDS.some((keyword) => line.includes(keyword)),
	)
}

function lines_missing_keyword(path: string): Array<string> {
	return commit_command_lines(path).filter((line) =>
		RESUME_KEYWORDS.some((keyword) => !line.includes(keyword)),
	)
}

describe('the halfrun resume a reader is told about', () => {
	it.each(RESUME_DOCUMENTS)('%s says a keyword resumes the stopped run from the gate', (path) => {
		expect(resume_lines(path).length).toBeGreaterThan(0)
	})

	it.each(RESUME_DOCUMENTS)('%s names the commit command', (path) => {
		expect(commit_command_lines(path).length).toBeGreaterThan(0)
	})

	it.each(RESUME_DOCUMENTS)('%s offers both keywords beside the commit command', (path) => {
		expect(lines_missing_keyword(path)).toStrictEqual([])
	})

	it.each(RESUME_DOCUMENTS)('%s does not say a keyword refuses the stopped tree', (path) => {
		expect(read_document(path)).not.toContain(REFUSED_START)
	})
})
