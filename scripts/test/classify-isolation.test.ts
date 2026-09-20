import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { classify_isolation } from './classify-isolation'

const { classify_pilot_files, is_pilot_candidate, render_pilot_files, requires_isolation } =
	classify_isolation

// Each string carries exactly one isolation condition from the classifier's documented five.
const ISOLATING_SOURCES: ReadonlyArray<[string, string]> = [
	['module mock', 'vi.mock("./thing")'],
	['spy', 'vi.spyOn(target, "run")'],
	['env stub', 'vi.stubEnv("KEY", "value")'],
	['global stub', 'vi.stubGlobal("process", fake)'],
	['reset modules', 'vi.resetModules()'],
	['env assignment', 'process.env.FOO = "bar"'],
	['env bracket assignment', 'process.env["FOO"] = "bar"'],
	['env delete', 'delete process.env.FOO'],
	['execSync', 'execSync("ls")'],
	['spawnSync', 'const r = spawnSync("git", ["status"])'],
	['execa', 'await execa("node", ["x.js"])'],
	['child_process import', 'import { fork } from "node:child_process"'],
	['file write', 'writeFileSync(target, data)'],
	['mkdir', 'mkdirSync(directory)'],
	['remove', 'rmSync(target)'],
]

// Reads, comparisons and the word "exec" inside a shell string must stay pure.
const PURE_SOURCES: ReadonlyArray<[string, string]> = [
	['env read', 'const value = process.env.FOO'],
	['env comparison', 'if (process.env.FOO === "bar") return'],
	['file read', 'const text = readFileSync(source, "utf8")'],
	['regex exec', 'const match = pattern.exec(input)'],
	['pnpm exec string', 'const step = "run: pnpm exec eslint"'],
	['existence check', 'expect(existsSync(target)).toBe(true)'],
]

describe('requires_isolation — the five documented conditions', () => {
	it('flags every isolating source', () => {
		for (const [label, source] of ISOLATING_SOURCES) {
			expect(requires_isolation(source), label).toBe(true)
		}
	})

	it('leaves pure sources alone', () => {
		for (const [label, source] of PURE_SOURCES) {
			expect(requires_isolation(source), label).toBe(false)
		}
	})
})

describe('classify_pilot_files — the generated candidate list', () => {
	const candidates = classify_pilot_files()

	it('returns a sorted, duplicate-free list of files that exist on disk', () => {
		expect(candidates.length).toBeGreaterThan(0)
		expect(new Set(candidates).size).toBe(candidates.length)
		expect([...candidates].toSorted(classify_isolation.by_code_point)).toEqual(candidates)
		for (const file of candidates) expect(existsSync(file), file).toBe(true)
	})

	it('classifies every returned file as a pilot candidate', () => {
		for (const file of candidates) expect(is_pilot_candidate(file), file).toBe(true)
	})

	it('returns only git-tracked files (hermetic against transient fixtures)', () => {
		const tracked = classify_isolation.tracked_files()

		for (const file of candidates) expect(tracked.has(file), file).toBe(true)
	})
})

describe('render_pilot_files — the regenerated artifact', () => {
	it('emits the generated banner and one quoted entry per file', () => {
		const rendered = render_pilot_files(['a/one.test.ts', 'b/two.test.ts'])

		expect(rendered).toContain('// GENERATED FILE — do not edit by hand.')
		expect(rendered).toContain("\t'a/one.test.ts',")
		expect(rendered).toContain("\t'b/two.test.ts',")
		expect(rendered).toContain('export { PILOT_FILES }')
	})
})
