import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { epic_chain_kind } from '#scripts/epic/epic-chain-kind'
import { package_path } from '#scripts/init/init-paths'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'

const SKILL_DIRECTORY = '.claude/skills/board-theme'
const TEMPLATE_FILE = 'demo-template.md'
const create_directory = temporary_directory()
const JS_BLOCK = /^```js\n(?<code>[\s\S]*?)^```$/gmu

function read_skill_file(name: string): string {
	return readFileSync(package_path(`${SKILL_DIRECTORY}/${name}`), 'utf8')
}

function js_blocks(markdown: string): Array<string> {
	return [...markdown.matchAll(JS_BLOCK)].map((match) => match.groups?.['code'] ?? '')
}

function node_check(code: string): number | null {
	const file = path.join(create_directory('board-theme-'), 'demo.mjs')

	writeFileSync(file, code)

	return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status
}

// A stand-in colored frame wide enough for the template's message span.
const FRAME_ROWS = 22
const FRAME_WIDTH = 120
const STAND_IN_FRAME = `\u{1B}[38;2;1;2;3m${'.'.repeat(FRAME_WIDTH)}\n`.repeat(FRAME_ROWS)
// Scene 1 loops ticks 45–115 (70 ticks), then 40 ticks of the normal display, then starts again.
const SCENE_TICKS = 70
const GAP_TICKS = 40
const AGAIN_TICKS = 5
const BEAT_STEPS = 3
const TICK_MS = 50
const RUN_TIMEOUT_MS = 30_000
const SCENE_CAPTION = /\[1\] TYPE - (?<what>normal|one)/gu

interface TemplateRun {
	status: number | null
	output: string
}

// Runs scene 1 of the template headless on the stand-in frame for `steps` frames, stdout to a file so
// `process.exit` loses no write.
function run_template(
	code: string,
	steps: number,
	environment: NodeJS.ProcessEnv = {},
): TemplateRun {
	const directory = create_directory('board-theme-run-')
	const script = path.join(directory, 'stand-in-theme-demo.mjs')
	const output_file = path.join(directory, 'out.txt')

	writeFileSync(script, code)
	writeFileSync(path.join(directory, 'stand-in-frame.ans'), STAND_IN_FRAME)
	const output = openSync(output_file, 'w')
	const { status } = spawnSync(process.execPath, [script, '1'], {
		env: { ...process.env, ...environment, DEMO_STEPS: String(steps) },
		stdio: ['ignore', output, 'inherit'],
		timeout: RUN_TIMEOUT_MS,
	})

	closeSync(output)

	return { status, output: readFileSync(output_file, 'utf8') }
}

// Each run of equal items and its length, in order.
function runs_of(items: ReadonlyArray<string>): Array<[string, number]> {
	const runs: Array<[string, number]> = []

	for (const item of items) {
		const last = runs.at(-1)

		if (last?.[0] === item) last[1] += 1
		else runs.push([item, 1])
	}

	return runs
}

// The scene caption of each frame: the scene's note (`one`) or the normal display (`normal`).
function captions_of(output: string): Array<string> {
	return [...output.matchAll(SCENE_CAPTION)].map((match) => match.groups?.['what'] ?? '')
}

describe('board-theme demo template', () => {
	const blocks = js_blocks(read_skill_file(TEMPLATE_FILE))

	it('holds the template in exactly one js code block', () => {
		expect(blocks).toHaveLength(1)
	})

	it('passes node --check', () => {
		expect(node_check(blocks[0] ?? '')).toBe(0)
	})

	it('reads a real colored frame, never a colorless one', () => {
		expect(blocks[0]).toMatch(/readFileSync\(new URL\(.*-frame\.ans/u)
		expect(read_skill_file(TEMPLATE_FILE)).not.toContain('NO_COLOR')
	})

	it.each([
		['scenes a key picks', 'const SCENES = {'],
		['raw-mode key input', 'process.stdin.setRawMode(true)'],
		['a Q quit', "if (ch === 'q' || ch === '\\u0003') process.exit(0)"],
		['a two-second gap between loops', 'const GAP_TICKS = 40'],
		['a frame count for a check without a terminal', 'process.env.DEMO_STEPS'],
	])('holds %s', (_name, code) => {
		expect(blocks[0]).toContain(code)
	})

	it('picks no variants by argument', () => {
		expect(blocks[0]).not.toContain('VARIANTS')
		expect(read_skill_file(TEMPLATE_FILE)).not.toContain('[variant]')
	})

	it('runs with one command and no argument', () => {
		expect(read_skill_file(TEMPLATE_FILE)).toContain(
			'pnpm josh scratch:run .josh/tmp/scratch/<theme>-theme-demo.mjs\n```',
		)
	})
})

describe('board-theme demo template run headless', () => {
	const [code = ''] = js_blocks(read_skill_file(TEMPLATE_FILE))

	it(
		'loops the scene with the normal display between plays, then ends after DEMO_STEPS frames',
		() => {
			const { status, output } = run_template(code, SCENE_TICKS + GAP_TICKS + AGAIN_TICKS)

			expect(status).toBe(0)
			expect(runs_of(captions_of(output))).toStrictEqual([
				['one', SCENE_TICKS],
				['normal', GAP_TICKS],
				['one', AGAIN_TICKS],
			])
		},
		RUN_TIMEOUT_MS,
	)

	it(
		'writes one JSON beat line per frame under DEMO_BEATS=1 and draws nothing on the terminal',
		() => {
			const { status, output } = run_template(code, BEAT_STEPS, { DEMO_BEATS: '1' })
			const lines = output.trimEnd().split('\n')
			const beats = lines.map((line) => JSON.parse(line) as { text: string; ms: number })

			expect(status).toBe(0)
			expect(beats.map((beat) => beat.ms)).toStrictEqual([TICK_MS, TICK_MS, TICK_MS])
			expect(beats.every((beat) => beat.text.includes('[1] TYPE'))).toBe(true)
			expect(output).not.toContain('?1049h')
		},
		RUN_TIMEOUT_MS,
	)

	it('seeds random() with the mulberry32 run-board-seeded.ts names', () => {
		expect(code).toContain('process.env.DEMO_SEED')
		expect(code).toContain('scripts/run/board/run-board-seeded.ts')
	})
})

describe('board-theme skill', () => {
	const skill = read_skill_file('SKILL.md')

	it('is read unasked before any board look change is proposed or filed', () => {
		expect(skill).toMatch(
			/^description: .*`run:board` look change.*unasked before proposing or filing/mu,
		)
	})

	it('bases a demo or a printf on a real colored frame, never a colorless one', () => {
		expect(skill).toContain('FORCE_COLOR=3 pnpm josh run:board --once --theme <theme>')
		expect(skill).not.toContain('NO_COLOR')
	})

	it.each([
		'It moves → a JS demo',
		'It does not move → a `printf` command',
		'Skip it for a fix that only restores the existing look',
		'Measure the original',
		'matches the original item by item',
		'items changed on purpose',
		"Put the demo's code in the Issue body when filing",
		'which element takes which color',
		"leaves the existing themes'\n  look unchanged",
		"Compare the implementation's commit with the demo's code",
	])('carries the step "%s"', (step) => {
		expect(skill).toContain(step)
	})

	it.each(['#8357', '#8377', '8376#issuecomment-', '8354#issuecomment-', '#8384', TEMPLATE_FILE])(
		'links the example %s',
		(example) => {
			expect(skill).toContain(example)
		},
	)
})

const SPLIT_FILE = 'theme-split.md'
const ORDER_REASON = /--order-reason "#<seam> -> #<effect>: (?<reason>[^"]+)"/u
const SEAM_CHAIN = [1, 2]

function section_of(markdown: string, heading: string): string {
	return markdown.split(heading)[1]?.split('\n## ', 1)[0] ?? ''
}

describe('board-theme skill theme split', () => {
	const skill = read_skill_file('SKILL.md')
	const split = read_skill_file(SPLIT_FILE)

	it('points step 5 at the seam-then-parallel split', () => {
		const step = section_of(skill, '## 5. File the Issue once the user decides')

		expect(step).toContain('seam child, then parallel effect children')
		expect(step).toContain(`(${SPLIT_FILE})`)
	})

	it.each([
		"the theme's row in `THEME_DEFS` with every field",
		'the colors',
		'the switches of the existing effects',
		'the signal each effect reads',
		'the draw order',
		'the shared timing constants',
		'a function that draws nothing',
		'It touches its own files and tests only, never a shared file',
		'Declare no dependency between effect children',
		'Compare the planned paths',
		'move that socket into the seam child',
		'after every effect child has\n  merged',
		'"6. After the first merge"',
	])('the split carries the rule "%s"', (rule) => {
		expect(split).toContain(rule)
	})

	it('gives an order reason the epic accepts for each seam-to-effect chain', () => {
		const reason = ORDER_REASON.exec(split)?.groups?.['reason'] ?? ''

		expect(reason).not.toBe('')
		expect(epic_chain_kind.find_refusal([{ chain: SEAM_CHAIN, reason }])).toBeUndefined()
	})
})

describe('board-theme skill demo shape', () => {
	const skill = read_skill_file('SKILL.md')

	it.each([
		'A number key picks a scene from its start',
		'two seconds of normal display',
		'the top two rows name the scene and list the keys',
		'`DEMO_STEPS=<n>`',
		'the one command, no argument, alone in its code block, no trailing comment',
	])('carries the rule "%s"', (rule) => {
		expect(skill).toContain(rule)
	})

	it('no longer plays one variant per argument', () => {
		expect(skill).not.toContain('One variant per argument')
	})
})
