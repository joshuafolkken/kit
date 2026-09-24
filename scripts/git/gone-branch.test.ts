import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BranchRecord } from './gone-branch'

// joshuafolkken/kit#2504: `josh ms` deletes local branches, so what this pins is which ones are
// never touched — unmerged, local-only, still tracking, or checked out in a lane.

vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const { git_spawn } = await import('./git-spawn')
const { gone_branch } = await import('./gone-branch')

const read = vi.mocked(git_spawn.read)
const DEFAULT_BRANCH = 'main'
const FOR_EACH_REF = 'for-each-ref'
const MERGED = new Set(['main', '10-lane', '11-lane', '12-lane'])

function record(name: string, is_gone: boolean, is_checked_out = false): BranchRecord {
	return { name, is_gone, is_checked_out }
}

function select(records: ReadonlyArray<BranchRecord>): Array<string> {
	return gone_branch.select_prunable(records, MERGED, DEFAULT_BRANCH)
}

describe('parsing the for-each-ref records', () => {
	it('reads gone and the work tree from the tab-separated fields', () => {
		const output = [
			'10-lane\t[gone]\trefs/remotes/origin/10-lane\t',
			'11-lane\t[ahead 1]\trefs/remotes/origin/11-lane\t/repo/lane',
			'local\t\t\t',
			'local-gone\t[gone]\trefs/heads/deleted\t',
			'',
		].join('\n')

		expect(gone_branch.parse_records(output)).toEqual([
			record('10-lane', true),
			record('11-lane', false, true),
			record('local', false),
			record('local-gone', false),
		])
	})
})

describe('selecting the branches to prune', () => {
	it('selects a branch that is gone and merged', () => {
		expect(select([record('10-lane', true)])).toEqual(['10-lane'])
	})

	it('keeps a gone branch that is not merged', () => {
		expect(select([record('99-unmerged', true)])).toEqual([])
	})

	it('keeps a merged branch with no upstream or a live one', () => {
		expect(select([record('11-lane', false)])).toEqual([])
	})

	it('keeps a gone, merged branch a work tree has checked out', () => {
		expect(select([record('12-lane', true, true)])).toEqual([])
	})

	it('never selects the default branch', () => {
		expect(select([record(DEFAULT_BRANCH, true)])).toEqual([])
	})
})

// `11-lane` is the branch `git branch -d` refuses, standing in for a disagreement between the reads.
function answer_reads(records: string, merged: string): void {
	read.mockImplementation(async (arguments_) => {
		if (arguments_[0] === 'fetch') return ''
		if (arguments_.some((argument) => argument.startsWith('--merged='))) return merged
		if (arguments_[0] === FOR_EACH_REF) return records
		if (arguments_.includes('11-lane')) throw new Error('not fully merged')

		return ''
	})
}

describe('pruning', () => {
	beforeEach(() => {
		read.mockReset()
	})

	it('fetches with --prune, then deletes each candidate with -d', async () => {
		answer_reads(
			'10-lane\t[gone]\trefs/remotes/origin/10-lane\t\n13-lane\t[gone]\trefs/remotes/origin/13-lane\t',
			'main\n10-lane',
		)

		const result = await gone_branch.prune(DEFAULT_BRANCH)

		expect(read).toHaveBeenNthCalledWith(1, ['fetch', '--prune'])
		expect(read).toHaveBeenCalledWith([
			FOR_EACH_REF,
			`--merged=refs/heads/${DEFAULT_BRANCH}`,
			'--format=%(refname:lstrip=2)',
			'refs/heads',
		])
		expect(read).toHaveBeenCalledWith(['branch', '-d', '10-lane'])
		expect(read).not.toHaveBeenCalledWith(['branch', '-d', '13-lane'])
		expect(result).toEqual({ deleted: ['10-lane'], failed: [] })
	})

	it('reports a branch git refused and carries on with the rest', async () => {
		answer_reads(
			'11-lane\t[gone]\trefs/remotes/origin/11-lane\t\n10-lane\t[gone]\trefs/remotes/origin/10-lane\t',
			'main\n10-lane\n11-lane',
		)

		expect(await gone_branch.prune(DEFAULT_BRANCH)).toEqual({
			deleted: ['10-lane'],
			failed: ['11-lane'],
		})
	})
})
