#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_launch_cli } from './lane-launch-cli'

// The `josh lane:launch` entry, kept apart from `lane-launch-cli.ts` because other modules import that
// one: a bundle is one file, so a main guard there would fire for every command that carries it
// (joshuafolkken/kit#4186).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const ARGV_OFFSET = 2

	process.exitCode = await lane_launch_cli.run(process.argv.slice(ARGV_OFFSET))
}
