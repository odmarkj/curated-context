/**
 * Project Seeding (Phase 2.6)
 *
 * Scans a project's config files and bootstraps memories on first encounter.
 * No LLM required — purely structural/deterministic extraction.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import type { Memory } from './llm.js';

interface SeedResult {
  memories: Memory[];
  filesScanned: number;
}

/**
 * Scan a project root and extract seed memories from configs, package files, and structure.
 */
export function seedProject(projectRoot: string): SeedResult {
  const memories: Memory[] = [];
  let filesScanned = 0;

  // --- package.json ---
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    filesScanned++;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

      if (pkg.name) {
        memories.push({ category: 'config', key: 'project-name', value: pkg.name, confidence: 0.6, source: 'seed' });
      }

      // Key dependencies
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const frameworkDeps = ['next', 'nuxt', 'remix', 'astro', 'svelte', 'vue', 'react', 'angular',
        'express', 'fastify', 'hono', 'koa', 'nest', 'django', 'flask', 'fastapi'];
      for (const fw of frameworkDeps) {
        if (allDeps[fw] || allDeps[`@${fw}/core`] || allDeps[`${fw}js`]) {
          memories.push({ category: 'architecture', key: `dep-${fw}`, value: `Uses ${fw}${allDeps[fw] ? ` (${allDeps[fw]})` : ''}`, confidence: 0.6, source: 'seed' });
        }
      }

      // ORM/DB
      const ormDeps = ['prisma', '@prisma/client', 'drizzle-orm', 'typeorm', 'sequelize', 'knex', 'mongoose'];
      for (const orm of ormDeps) {
        if (allDeps[orm]) {
          const name = orm.replace('@prisma/client', 'Prisma').replace('drizzle-orm', 'Drizzle');
          memories.push({ category: 'architecture', key: `dep-orm`, value: `Uses ${name} for database`, confidence: 0.6, source: 'seed' });
          break;
        }
      }

      // Testing
      const testDeps = ['vitest', 'jest', 'mocha', 'ava', 'playwright', 'cypress'];
      for (const t of testDeps) {
        if (allDeps[t] || allDeps[`@${t}/test`]) {
          memories.push({ category: 'tooling', key: `test-runner`, value: `Uses ${t} for testing`, confidence: 0.6, source: 'seed' });
          break;
        }
      }

      // Package manager
      if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
        memories.push({ category: 'tooling', key: 'package-manager', value: 'Uses pnpm', confidence: 0.6, source: 'seed' });
      } else if (existsSync(join(projectRoot, 'yarn.lock'))) {
        memories.push({ category: 'tooling', key: 'package-manager', value: 'Uses yarn', confidence: 0.6, source: 'seed' });
      } else if (existsSync(join(projectRoot, 'bun.lockb'))) {
        memories.push({ category: 'tooling', key: 'package-manager', value: 'Uses bun', confidence: 0.6, source: 'seed' });
      }
    } catch { /* malformed package.json */ }
  }

  // --- pyproject.toml ---
  const pyprojectPath = join(projectRoot, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    filesScanned++;
    try {
      const content = readFileSync(pyprojectPath, 'utf8');
      const nameMatch = content.match(/^name\s*=\s*"(.+)"/m);
      if (nameMatch) {
        memories.push({ category: 'config', key: 'project-name', value: nameMatch[1], confidence: 0.6, source: 'seed' });
      }

      // Detect frameworks
      if (content.includes('fastapi')) memories.push({ category: 'architecture', key: 'dep-fastapi', value: 'Uses FastAPI', confidence: 0.6, source: 'seed' });
      if (content.includes('django')) memories.push({ category: 'architecture', key: 'dep-django', value: 'Uses Django', confidence: 0.6, source: 'seed' });
      if (content.includes('flask')) memories.push({ category: 'architecture', key: 'dep-flask', value: 'Uses Flask', confidence: 0.6, source: 'seed' });
    } catch { /* */ }
  }

  // --- Cargo.toml ---
  if (existsSync(join(projectRoot, 'Cargo.toml'))) {
    filesScanned++;
    memories.push({ category: 'architecture', key: 'language', value: 'Rust project (Cargo.toml)', confidence: 0.6, source: 'seed' });
  }

  // --- go.mod ---
  if (existsSync(join(projectRoot, 'go.mod'))) {
    filesScanned++;
    memories.push({ category: 'architecture', key: 'language', value: 'Go project (go.mod)', confidence: 0.6, source: 'seed' });
  }

  // --- tsconfig.json ---
  if (existsSync(join(projectRoot, 'tsconfig.json'))) {
    filesScanned++;
    memories.push({ category: 'config', key: 'typescript', value: 'TypeScript enabled (tsconfig.json present)', confidence: 0.6, source: 'seed' });
  }

  // --- Docker ---
  if (existsSync(join(projectRoot, 'Dockerfile'))) {
    filesScanned++;
    memories.push({ category: 'infrastructure', key: 'containerized', value: 'Docker containerized (Dockerfile present)', confidence: 0.6, source: 'seed' });
  }
  if (existsSync(join(projectRoot, 'docker-compose.yml')) || existsSync(join(projectRoot, 'docker-compose.yaml')) || existsSync(join(projectRoot, 'compose.yml'))) {
    filesScanned++;
    memories.push({ category: 'infrastructure', key: 'docker-compose', value: 'Uses Docker Compose for orchestration', confidence: 0.6, source: 'seed' });
  }

  // --- CI/CD ---
  if (existsSync(join(projectRoot, '.github', 'workflows'))) {
    filesScanned++;
    try {
      const workflows = readdirSync(join(projectRoot, '.github', 'workflows'))
        .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      if (workflows.length > 0) {
        memories.push({ category: 'tooling', key: 'ci-cd', value: `GitHub Actions CI/CD (${workflows.length} workflow${workflows.length > 1 ? 's' : ''})`, confidence: 0.6, source: 'seed' });
      }
    } catch { /* */ }
  }
  if (existsSync(join(projectRoot, '.gitlab-ci.yml'))) {
    filesScanned++;
    memories.push({ category: 'tooling', key: 'ci-cd', value: 'GitLab CI/CD', confidence: 0.6, source: 'seed' });
  }

  // --- Monorepo detection ---
  const hasWorkspaces = existsSync(join(projectRoot, 'packages')) || existsSync(join(projectRoot, 'apps'));
  if (hasWorkspaces) {
    try {
      const dirs: string[] = [];
      for (const dir of ['packages', 'apps']) {
        const fullPath = join(projectRoot, dir);
        if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
          const subs = readdirSync(fullPath).filter((f) => {
            try { return statSync(join(fullPath, f)).isDirectory(); } catch { return false; }
          });
          dirs.push(...subs.map((s) => `${dir}/${s}`));
        }
      }
      if (dirs.length > 0) {
        memories.push({ category: 'architecture', key: 'monorepo', value: `Monorepo with ${dirs.length} packages: ${dirs.slice(0, 5).join(', ')}${dirs.length > 5 ? '...' : ''}`, confidence: 0.6, source: 'seed' });
      }
    } catch { /* */ }
  }

  return { memories, filesScanned };
}
