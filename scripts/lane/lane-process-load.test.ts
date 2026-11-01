import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_process_load } from './lane-process-load'

// joshuafolkken/kit#3874: load 93 with 1.6 lanes working, and nothing on record to say what made it —
// a load sample now carries the heaviest process kinds, read off `ps`'s command lines.

const execa = vi.hoisted(() => vi.fn(async (): Promise<{ stdout: string }> => ({ stdout: '' })))

vi.mock('execa', () => ({ execa }))

const KB_PER_MB = 1024
const LISTING = [
	`${String(512 * KB_PER_MB)} 150.0 node /repo/node_modules/.pnpm/vitest/vitest.mjs run`,
	`${String(256 * KB_PER_MB)} 60.4 node /repo/node_modules/.pnpm/vitest/dist/workers/forks.js`,
	`${String(1024 * KB_PER_MB)} 90.0 node /repo/node_modules/eslint/bin/eslint.js .`,
	`${String(64 * KB_PER_MB)} 2.0 node /repo/node_modules/tsx/dist/cli.mjs scripts/josh/josh.ts gate`,
	`${String(2048 * KB_PER_MB)} 1.0 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
	`${String(16 * KB_PER_MB)} 0.5 /usr/bin/login`,
	`${String(32 * KB_PER_MB)} 0.0 /Users/me/.local/bin/claude --output-format stream-json`,
	'not a ps line',
].join('\n')

beforeEach(() => {
	execa.mockReset()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

const KIND_CASES: Array<[string, string]> = [
	['node /repo/node_modules/.bin/vitest related a.ts', 'vitest'],
	['pnpm exec vitest run', 'vitest'],
	['node /repo/node_modules/typescript/bin/tsc --noEmit', 'tsc'],
	['node /repo/node_modules/svelte-check/bin/svelte-check', 'tsc'],
	['node /repo/node_modules/cspell/bin.mjs lint .', 'cspell'],
	['node /repo/node_modules/prettier/bin/prettier.cjs --check .', 'prettier'],
	['node /repo/node_modules/@playwright/test/cli.js test', 'playwright'],
	['/cache/ms-playwright/chromium-1200/chrome-mac/Chromium --headless', 'playwright'],
	['/cache/chromium_headless_shell-1200/headless_shell --type=renderer', 'chromium'],
	['/Users/me/.local/bin/claude -p', 'claude'],
	['node --import tsx scripts/josh/josh.ts ship', 'josh'],
	['/Applications/Visual Studio Code.app/Contents/MacOS/Code Helper', 'vscode'],
	[
		'/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin) /extensions/node_modules/typescript/lib/tsserver.js',
		'vscode',
	],
	['Code Helper (Plugin) /extensions/vscode-eslint/server/out/eslintServer.js', 'vscode'],
	[
		'node /Users/me/.vscode/extensions/vendor.vscode-eslint-3.0.34/server/out/eslintServer.js',
		'vscode',
	],
	['node /Users/me/.npm-global/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'claude'],
	['/bin/zsh -c source /Users/me/.claude/shell-snapshots/snapshot.sh && git status', 'other'],
	['/bin/bash /Users/me/.claude/hooks/notify.sh', 'other'],
	[
		'/repo/node_modules/.pnpm/@esbuild+darwin-arm64@0.25.0/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.25.0',
		'other',
	],
	['node /opt/homebrew/bin/pnpm josh gate', 'josh'],
	['node server.js', 'node'],
	['/usr/sbin/mDNSResponder', 'other'],
]

describe('lane_process_load.kind_of', () => {
	it.each(KIND_CASES)('reads %s as %s', (command_line, kind) => {
		expect(lane_process_load.kind_of(command_line)).toBe(kind)
	})
})

describe('lane_process_load.summarize', () => {
	it('sums each kind and keeps the heaviest first, by CPU then memory', () => {
		expect(lane_process_load.summarize(LISTING)).toStrictEqual([
			{ kind: 'vitest', cpu_percent: 210, rss_mb: 768, count: 2 },
			{ kind: 'eslint', cpu_percent: 90, rss_mb: 1024, count: 1 },
			{ kind: 'josh', cpu_percent: 2, rss_mb: 64, count: 1 },
			{ kind: 'chrome', cpu_percent: 1, rss_mb: 2048, count: 1 },
			{ kind: 'other', cpu_percent: 1, rss_mb: 16, count: 1 },
		])
	})

	it('keeps no more than the top kinds', () => {
		expect(lane_process_load.summarize(LISTING)).toHaveLength(lane_process_load.TOP_KINDS)
	})

	it('reads an empty listing as no kinds', () => {
		expect(lane_process_load.summarize('')).toStrictEqual([])
	})
})

// joshuafolkken/kit#5658: the IDE and browser a person keeps open, summed by command-line name.
describe('lane_process_load.resident_mb', () => {
	const VSCODE = `${String(1024 * KB_PER_MB)} 3.0 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app`
	const TESTING = `${String(512 * KB_PER_MB)} 9.0 /cache/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`

	it('sums every process a resident app runs', () => {
		expect(
			lane_process_load.resident_mb(`${LISTING}\n${VSCODE}`, lane_process_load.RESIDENT_APPS),
		).toBe(3072)
	})

	it("leaves Playwright's testing browser out of the person's own", () => {
		expect(
			lane_process_load.resident_mb(`${LISTING}\n${TESTING}`, lane_process_load.RESIDENT_APPS),
		).toBe(2048)
	})

	it('sums only the names it is given', () => {
		expect(lane_process_load.resident_mb(`${LISTING}\n${VSCODE}`, ['Visual Studio Code'])).toBe(
			1024,
		)
	})

	it('answers nothing with no names to match', () => {
		expect(lane_process_load.resident_mb(LISTING, [])).toBeUndefined()
	})
})

// joshuafolkken/kit#5690: `JOSH_LANE_RESIDENT_APPS` names the resident apps.
describe('lane_process_load.resident_apps', () => {
	it('keeps the default names when the variable is unset', () => {
		vi.stubEnv('JOSH_LANE_RESIDENT_APPS', undefined)

		expect(lane_process_load.resident_apps()).toStrictEqual(lane_process_load.RESIDENT_APPS)
	})

	it('names no app when the variable is empty', () => {
		expect(lane_process_load.resident_apps('')).toStrictEqual([])
	})

	it('reads several comma-separated names, trimmed', () => {
		expect(lane_process_load.resident_apps('Firefox.app, Zed.app,')).toStrictEqual([
			'Firefox.app',
			'Zed.app',
		])
	})

	it('reads the variable from the environment', () => {
		vi.stubEnv('JOSH_LANE_RESIDENT_APPS', 'Zed.app')

		expect(lane_process_load.resident_apps()).toStrictEqual(['Zed.app'])
	})
})

describe('lane_process_load.read', () => {
	it('summarizes the live listing', async () => {
		vi.stubEnv('JOSH_LANE_RESIDENT_APPS', undefined)
		execa.mockResolvedValue({ stdout: LISTING })

		const reading = await lane_process_load.read()

		expect(reading?.processes).toHaveLength(lane_process_load.TOP_KINDS)
		expect(reading?.resident_mb).toBe(2048)
		expect(execa).toHaveBeenCalledWith(
			'ps',
			expect.any(Array),
			expect.objectContaining({ env: { LC_ALL: 'C' } }),
		)
	})

	it('sums the apps the environment names', async () => {
		vi.stubEnv('JOSH_LANE_RESIDENT_APPS', 'eslint.js')
		execa.mockResolvedValue({ stdout: LISTING })

		const reading = await lane_process_load.read()

		expect(reading?.resident_mb).toBe(1024)
	})

	it('answers nothing when ps does not answer', async () => {
		execa.mockRejectedValue(new Error('ps: not found'))

		await expect(lane_process_load.read()).resolves.toBeUndefined()
	})
})
