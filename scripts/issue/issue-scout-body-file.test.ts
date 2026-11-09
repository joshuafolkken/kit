import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { cli_body_repository } from '#scripts/josh/cli-body-repository-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

const TITLE = 'Add one acceptance criterion'
const BODY = '## 目的\n\n追加目的\n\n## 受け入れ条件\n\n- [ ] 検証可能'
const BODY_FILE_OPTION = '--body-file'

const make_directory = temporary_directory('suite')
const work = make_directory('issue-scout-body-file-')
const draft_path = path.join(work, 'draft.md')
const repository = cli_body_repository.create(make_directory('issue-scout-body-file-repository-'))

writeFileSync(draft_path, BODY)

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_scout_cli draft body', () => {
	it('accepts a complete draft from a file', () => {
		const args = issue_scout_cli.read_arguments([TITLE, BODY_FILE_OPTION, draft_path])

		expect(args).toBeDefined()
		if (args === undefined) return
		expect(issue_scout_cli.with_draft_body(args)?.body).toBe(BODY)
	})

	it('refuses a failed body read instead of scanning an empty draft', () => {
		const args = issue_scout_cli.read_arguments([
			TITLE,
			BODY_FILE_OPTION,
			path.join(work, 'absent.md'),
		])

		expect(args).toBeDefined()
		if (args === undefined) return
		expect(issue_scout_cli.with_draft_body(args)).toBeUndefined()
	})

	// joshuafolkken/kit#6056: the draft is read through `cli_body`, and its refusal is printed.
	it('refuses a draft in the work tree that git does not ignore, naming why', () => {
		const tree_path = repository.write(cli_body_repository.UNIGNORED_DIRECTORY, BODY)
		const args = issue_scout_cli.read_arguments([TITLE, BODY_FILE_OPTION, tree_path])

		expect(args).toBeDefined()
		if (args === undefined) return
		expect(issue_scout_cli.with_draft_body(args)).toBeUndefined()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not git-ignored'))
	})

	it('refuses two competing body inputs', () => {
		expect(
			issue_scout_cli.read_arguments([TITLE, '--body', BODY, BODY_FILE_OPTION, draft_path]),
		).toBeUndefined()
	})
})
