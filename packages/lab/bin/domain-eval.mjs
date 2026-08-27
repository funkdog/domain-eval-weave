#!/usr/bin/env node

import { runCapsuleCli } from "../dist/cli.js";

process.exitCode = await runCapsuleCli(process.argv.slice(2));
