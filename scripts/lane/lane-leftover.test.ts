import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2857: a lane directory git no longer registers is removed only when removing it
// loses nothing. `git_spawn` is mocked so the tree listing is the fixture's; the files themselves are
// real, and the object ids are checked against `git hash-object` so the fixture cannot drift from git.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { lane_leftover } = await import('./lane-leftover')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-leftover-test-'))
const CONFIG_PATH = '.codex/config.toml'
const CONFIG_CONTENT = 'model = "x"\n'
const SKILLS_PATH = '.agents/skills'
const SKILLS_TARGET = '../.claude/skills'
// A file under the symlink's target, which a walk that follows the link would list twice.
const SKILL_PATH = '.claude/skills/review/SKILL.md'
const SKILL_CONTENT = '# review\n'
const POINTER_CONTENT = 'gitdir: /nowhere/.git/worktrees/2842\n'
const SYMLINK_MODE = '120000'
const FILE_MODE = '100644'

const NOTES_PATH = 'notes.md'
const NOTES_CONTENT = 'work in progress\n'
const cases = { directory: '', index: 0 }

function hash_object(file: string): string {
	return execFileSync('git', ['hash-object', '--no-filters', file], { encoding: 'utf8' }).trim()
}

function write_file(relative: string, content: string): void {
	const file = path.join(cases.directory, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

// The leftover #2842 found: the `.git` pointer, the skills symlink and the Codex configuration.
function write_leftover(): void {
	write_file('.git', POINTER_CONTENT)
	write_file(CONFIG_PATH, CONFIG_CONTENT)
	mkdirSync(path.join(cases.directory, '.agents'), { recursive: true })
	symlinkSync(SKILLS_TARGET, path.join(cases.directory, SKILLS_PATH))
}

// The listing `git ls-tree -r -z --full-tree HEAD` would print for a repository holding the leftover.
function tree_listing(): string {
	const config_id = lane_leftover.blob_id(path.join(cases.directory, CONFIG_PATH))
	const skills_id = lane_leftover.blob_id(path.join(cases.directory, SKILLS_PATH))

	return [
		`${FILE_MODE} blob ${config_id}\t${CONFIG_PATH}`,
		`${SYMLINK_MODE} blob ${skills_id}\t${SKILLS_PATH}`,
		'',
	].join('\0')
}

function tracked(): Map<string, string> {
	return lane_leftover.parse_tree(tree_listing())
}

beforeEach(() => {
	cases.index += 1
	cases.directory = path.join(scratch, String(cases.index))
	mkdirSync(cases.directory, { recursive: true })
	vi.mocked(git_spawn.read).mockReset()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('lane_leftover.blob_id', () => {
	it('matches git for a regular file', () => {
		write_file(CONFIG_PATH, CONFIG_CONTENT)
		const file = path.join(cases.directory, CONFIG_PATH)

		expect(lane_leftover.blob_id(file)).toBe(hash_object(file))
	})

	it('hashes a symbolic link by its target string, as git stores it', () => {
		const link = path.join(cases.directory, 'link')

		symlinkSync(SKILLS_TARGET, link)
		writeFileSync(path.join(cases.directory, 'target'), SKILLS_TARGET)

		expect(lane_leftover.blob_id(link)).toBe(hash_object(path.join(cases.directory, 'target')))
	})
})

describe('lane_leftover.foreign_paths', () => {
	it('finds nothing foreign in a leftover of only repository files and the .git pointer', () => {
		write_leftover()

		expect(lane_leftover.foreign_paths(cases.directory, tracked())).toStrictEqual([])
	})

	it('names an untracked file and a tracked file whose content changed', () => {
		write_leftover()
		const listing = tracked()

		write_file(NOTES_PATH, NOTES_CONTENT)
		write_file(CONFIG_PATH, 'model = "edited"\n')

		expect(lane_leftover.foreign_paths(cases.directory, listing)).toStrictEqual(
			expect.arrayContaining([CONFIG_PATH, NOTES_PATH]),
		)
	})

	it('treats a .git directory as a repository of its own', () => {
		mkdirSync(path.join(cases.directory, '.git'))

		expect(lane_leftover.foreign_paths(cases.directory, new Map())).toStrictEqual(['.git'])
	})
})

describe('lane_leftover.foreign_paths on a live or linked tree', () => {
	it('names the .git pointer while the registration it points to still exists', () => {
		write_leftover()
		const registration = path.join(cases.directory, 'registration')

		mkdirSync(registration)
		write_file('.git', `gitdir: ${registration}\n`)

		expect(lane_leftover.foreign_paths(cases.directory, tracked())).toStrictEqual(
			expect.arrayContaining(['.git']),
		)
	})

	it('does not walk into a symbolic link to a directory the repository also holds', () => {
		write_leftover()
		write_file(SKILL_PATH, SKILL_CONTENT)
		const listing = new Map([
			...tracked(),
			[SKILL_PATH, lane_leftover.blob_id(path.join(cases.directory, SKILL_PATH))],
		])

		expect(lane_leftover.foreign_paths(cases.directory, listing)).toStrictEqual([])
	})
})

describe('lane_leftover.reclaim', () => {
	it('does nothing, and asks git nothing, when the directory is absent', async () => {
		await lane_leftover.reclaim(path.join(cases.directory, 'missing'))

		expect(git_spawn.read).not.toHaveBeenCalled()
	})

	it('removes a leftover that holds only repository files', async () => {
		write_leftover()
		vi.mocked(git_spawn.read).mockResolvedValue(tree_listing())

		await lane_leftover.reclaim(cases.directory)

		expect(existsSync(cases.directory)).toBe(false)
	})

	it('keeps a leftover holding other files and names them in the refusal', async () => {
		write_leftover()
		vi.mocked(git_spawn.read).mockResolvedValue(tree_listing())
		write_file(NOTES_PATH, NOTES_CONTENT)

		await expect(lane_leftover.reclaim(cases.directory)).rejects.toThrow(/notes\.md/u)
		expect(existsSync(path.join(cases.directory, NOTES_PATH))).toBe(true)
	})
})
