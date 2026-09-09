import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { scoped_green } from '#scripts/scoped-green'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_brief_cli } from './review-brief-cli'
import { review_tree } from './review-tree'

// joshuafolkken/kit#1511: round 1 is refused outright when the scoped checks have never been green on
// this tree, rather than being briefed with a line saying so. A brief that *mentions* the gap is one
// more fact for the review agent to weigh; what has to happen is that no brief exists — this command
// mints the nonce `review:attest --check` compares, so a round that never reaches it cannot be
// counted.
//
// **Every git reader is mocked, and CI is why.** `run` resolves the change base and the changed paths
// before it asks anything else, and a GitHub Actions checkout has no local `main` ref — so a suite
// that let those calls through passed here and died with `fatal: bad revision 'main'` on the runner.
// Nothing about this rule needs a real repository.
//
// **Only the refusing path is exercised.** The passing path composes a brief, which mints an
// attestation nonce and writes the round-1 snapshot to the record this checkout's own run relies on —
// the second writer joshuafolkken/kit#1441 and joshuafolkken/kit#1437 both closed. That path is
// unchanged by this issue, and `review-round1-snapshot.test.ts` is where it is pinned.

vi.mock('#scripts/scoped-green', () => ({ scoped_green: { refusal_for: vi.fn() } }))
vi.mock('#scripts/git/change-base', () => ({ change_base: { resolved: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({ changed_paths: { read_changed_paths: vi.fn() } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { change_base: vi.fn() } }))
vi.mock('./review-tree', () => ({ review_tree: { read_changed_tree: vi.fn() } }))

const mocked_refusal = vi.mocked(scoped_green.refusal_for)
const mocked_base = vi.mocked(change_base.resolved)
const mocked_paths = vi.mocked(changed_paths.read_changed_paths)
const mocked_tree = vi.mocked(review_tree.read_changed_tree)

const REFUSAL = '⛔ scoped checks not green on this tree: run them and reissue'
const REFUSED_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []
const RESOLVED_COMMIT = 'a22b347965292713d70daff6e2b948dc7009a265'
const CHANGED_FILE = 'scripts/scoped-green.ts'
const CHANGED_TREE = { [CHANGED_FILE]: 'digest' }

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	mocked_base.mockResolvedValue(RESOLVED_COMMIT)
	mocked_paths.mockResolvedValue([CHANGED_FILE])
	mocked_tree.mockResolvedValue(CHANGED_TREE)
	mocked_refusal.mockReturnValue(REFUSAL)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh review:brief without a scoped green record', () => {
	it('exits non-zero rather than composing a brief', async () => {
		await expect(review_brief_cli.run(NO_ARGUMENTS)).resolves.toBe(REFUSED_EXIT_CODE)
	})

	it('puts the refusal on stderr and prints no brief at all', async () => {
		await review_brief_cli.run(NO_ARGUMENTS)

		expect(console.error).toHaveBeenCalledWith(REFUSAL)
		expect(console.info).not.toHaveBeenCalled()
	})

	// The record stores a commit, and `change_base` degrades to the default-branch *name* when
	// `merge-base` cannot answer. Asked with that name, the comparison would match while the ref moved.
	it('asks about the resolved change base, not the default-branch name', async () => {
		await review_brief_cli.run(NO_ARGUMENTS)

		expect(mocked_refusal).toHaveBeenCalledOnce()
		expect(mocked_refusal).toHaveBeenCalledWith(CHANGED_TREE, RESOLVED_COMMIT)
	})
})

describe('report_error', () => {
	it('returns the failure code and writes the text it was handed', () => {
		expect(review_brief_cli.report_error(REFUSAL)).toBe(REFUSED_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(REFUSAL)
	})
})
