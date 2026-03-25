#!/usr/bin/env node

// setup.js — Setup hook handler
// Runs once when the plugin is installed/enabled.
// Ensures runtime dependencies (node_modules/) are present.

import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  || join(import.meta.url, '..', '..').replace('file://', '');

const nodeModulesDir = join(pluginRoot, 'node_modules');

if (!existsSync(nodeModulesDir)) {
  try {
    execSync('npm install --omit=dev', {
      cwd: pluginRoot,
      stdio: 'ignore',
      timeout: 60000,
    });
  } catch {
    // Non-fatal — SessionStart hook will retry
  }
}

process.stdout.write('{}');
