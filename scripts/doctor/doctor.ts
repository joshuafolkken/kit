#!/usr/bin/env tsx
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { running_binary } from '#scripts/version/running-binary'
import { doctor_io } from './doctor-io'
import { doctor_logic } from './doctor-logic'

const FIX_FLAG = '--fix'
const UNKNOWN = '(unknown)'
const NOT_ON_PATH = '(not on PATH)'
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))

interface DoctorContext {
	running_version: string | undefined
	running_path: string
	path_josh: string | undefined
	global_josh: string | undefined
}

function gather_context(): DoctorContext {
	return {
		running_version: running_binary.read_running_version(SELF_DIR),
		running_path: running_binary.running_package_directory(SELF_DIR),
		path_josh: doctor_io.resolve_path_josh(),
		global_josh: doctor_io.resolve_pnpm_global_josh(),
	}
}

function print_report(ctx: DoctorContext): void {
	console.info('josh doctor')
	console.info(`  Running:     ${ctx.running_version ?? UNKNOWN}  (${ctx.running_path})`)
	console.info(`  On PATH:     ${ctx.path_josh ?? NOT_ON_PATH}`)
	console.info(`  pnpm global: ${ctx.global_josh ?? UNKNOWN}`)
}

// Remove a confirmed stale kit shim so the pnpm-global josh reclaims PATH precedence. Any other
// shadowing binary is left in place and reported for manual review.
function reclaim_shim(path_josh: string, global_josh: string): void {
	const content = readFileSync(path_josh, 'utf8')
	const decision = doctor_logic.decide_reclaim(path_josh, global_josh, content)

	if (decision.action !== 'remove' || decision.target === undefined) {
		console.info(`  ${decision.reason}`)

		return
	}

	rmSync(decision.target)
	console.info(`  ✓ ${decision.reason}: ${decision.target}`)
}

function handle_shadow(ctx: DoctorContext, is_fix: boolean): void {
	if (ctx.path_josh === undefined || ctx.global_josh === undefined) return
	console.info('')
	console.info(doctor_logic.format_shadow_warning(ctx.path_josh, ctx.global_josh))
	if (is_fix) reclaim_shim(ctx.path_josh, ctx.global_josh)
}

function main(): void {
	const is_fix = process.argv.includes(FIX_FLAG)
	const ctx = gather_context()

	print_report(ctx)

	if (doctor_logic.is_shadowed(ctx.path_josh, ctx.global_josh)) {
		handle_shadow(ctx, is_fix)

		return
	}

	console.info('  ✓ no PATH shadowing detected')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const doctor = { gather_context, print_report, reclaim_shim, handle_shadow }

export type { DoctorContext }
export { doctor }
