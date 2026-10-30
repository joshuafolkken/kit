import { git_command } from '#scripts/git/git-command'
import { line_targets } from '#scripts/lines/line-targets'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { import_graph } from './import-graph'
import { refactor_lint } from './refactor-lint'
import { refactor_scan } from './refactor-scan'
import { refactor_targets } from './refactor-targets'

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/lines/line-targets', () => ({ line_targets: { lint_target_files: vi.fn() } }))
vi.mock('./import-graph', () => ({ import_graph: { expand_scope: vi.fn(), MAX_STAGES: 3 } }))
vi.mock('./refactor-targets', () => ({ refactor_targets: { collect_targets: vi.fn() } }))
vi.mock('./refactor-lint', () => ({ refactor_lint: { scan_categories: vi.fn(), LOW: 'low' } }))

const FILES = ['scripts/a.ts']
const TIMEOUT_DIAGNOSTIC = 'ESLint timed out'

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(git_command.repository_root).mockResolvedValue('/repo')
	vi.mocked(refactor_targets.collect_targets).mockResolvedValue(FILES)
	vi.mocked(line_targets.lint_target_files).mockResolvedValue(FILES)
	vi.mocked(import_graph.expand_scope).mockReturnValue(new Set(FILES))
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

describe('refactor scan exit status', () => {
	it('exits non-zero and reports the execution diagnostic with the unchanged scope', async () => {
		vi.mocked(refactor_lint.scan_categories).mockRejectedValue(new Error(TIMEOUT_DIAGNOSTIC))

		expect(await refactor_scan.run_scan()).toBe(1)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining(TIMEOUT_DIAGNOSTIC))
		expect(process.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('scope: 1 files (seed 1,'),
		)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('verdict: error'))
	})

	it('exits zero for a completed clear scan', async () => {
		vi.mocked(refactor_lint.scan_categories).mockResolvedValue([])

		expect(await refactor_scan.run_scan()).toBe(0)
		expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('verdict: clear'))
	})

	it('exits zero for a completed scan with candidates', async () => {
		vi.mocked(refactor_lint.scan_categories).mockResolvedValue([
			{
				key: 'type-safety',
				label: 'type safety',
				priority: 'high',
				candidates: [{ location: 'scripts/a.ts:1', rule: 'max-lines' }],
			},
		])

		expect(await refactor_scan.run_scan()).toBe(0)
		expect(process.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('verdict: candidates'),
		)
	})
})
