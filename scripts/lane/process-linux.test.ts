import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { process_linux } from './process-linux'

const ROOT = mkdtempSync(path.join(tmpdir(), 'process-linux-'))
const PID = '123'
const CWD = '/work/.kit-lanes/5444'
const LANE_MARK = 'JOSH_LANE_CHILD=5444\0'

afterEach(() => {
	rmSync(ROOT, { force: true, recursive: true })
})

function write_process(content: string): void {
	const directory = path.join(ROOT, PID)

	mkdirSync(directory, { recursive: true })
	symlinkSync(CWD, path.join(directory, 'cwd'))
	writeFileSync(path.join(directory, 'environ'), content)
}

it('reads only exact inherited lane assignments from Linux process metadata', () => {
	write_process('OTHER=pretend JOSH_LANE_CHILD=999\0JOSH_LANE_CHILD=5444\0')
	expect(process_linux.read_processes(ROOT)).toEqual([
		{ pid: Number(PID), directory: CWD, issue: '5444' },
	])
})

it('ignores a process that exited between enumeration and its metadata read', () => {
	mkdirSync(path.join(ROOT, PID), { recursive: true })
	expect(process_linux.read_processes(ROOT)).toEqual([])
})

it('reports unreadable Linux process metadata instead of no owners', () => {
	write_process(LANE_MARK)
	rmSync(path.join(ROOT, PID, 'environ'))
	mkdirSync(path.join(ROOT, PID, 'environ'))
	expect(process_linux.read_processes(ROOT)).toBeUndefined()
})

it('never attributes another account process to the current lane', () => {
	write_process(LANE_MARK)
	const other_account = statSync(ROOT).uid + 1

	expect(process_linux.read_processes(ROOT, other_account)).toEqual([])
})
