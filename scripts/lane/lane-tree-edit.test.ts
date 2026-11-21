import { change_base } from '#scripts/git/change-base'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_tree_edit } from './lane-tree-edit'

// joshuafolkken/kit#7729: a lane has made its first edit once its tree differs from its base.

const BASE = 'abc123'
const NUMSTAT = '3\t1\tscripts/lane/lane-plan.ts'
const UNTRACKED = 'scripts/lane/new.ts'

const resolved = vi.spyOn(change_base, 'resolved_through_merge')
const numstat = vi.spyOn(git_command, 'diff_numstat_since')
const untracked = vi.spyOn(git_command, 'untracked_names')

beforeEach(() => {
	resolved.mockResolvedValue(BASE)
	numstat.mockResolvedValue('')
	untracked.mockResolvedValue('')
})

describe('lane_tree_edit.is_edited', () => {
	it('reads an unchanged tree as not edited', async () => {
		expect(await lane_tree_edit.is_edited()).toBe(false)
		expect(numstat).toHaveBeenCalledWith(BASE)
	})

	it('reads a tracked change or an untracked file as edited', async () => {
		numstat.mockResolvedValueOnce(NUMSTAT)

		expect(await lane_tree_edit.is_edited()).toBe(true)

		untracked.mockResolvedValueOnce(UNTRACKED)

		expect(await lane_tree_edit.is_edited()).toBe(true)
	})

	it('reads an unresolved base as edited', async () => {
		resolved.mockResolvedValue(undefined)

		expect(await lane_tree_edit.is_edited()).toBe(true)
		expect(numstat).not.toHaveBeenCalled()
	})
})
