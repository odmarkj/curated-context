import type { ToolEvent } from './transcript.js';

export interface StructuralMemory {
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  scope?: 'project' | 'global';
}

const CONFIG_FILES = new Set([
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'tailwind.config.js',
  'tailwind.config.ts',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'vite.config.ts',
  'vite.config.js',
  'nuxt.config.ts',
  'svelte.config.js',
  'drizzle.config.ts',
  'prisma/schema.prisma',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  '.env.example',
  'jest.config.js',
  'jest.config.ts',
  'vitest.config.ts',
  'biome.json',
]);

// Well-known packages → global technology preferences
const FRAMEWORK_MAP: Record<string, { prefKey: string; description: string }> = {
  // Web frameworks
  'next': { prefKey: 'pref-framework-nextjs', description: 'Next.js for React apps' },
  'nuxt': { prefKey: 'pref-framework-nuxt', description: 'Nuxt for Vue apps' },
  'svelte': { prefKey: 'pref-framework-svelte', description: 'Svelte/SvelteKit' },
  '@sveltejs/kit': { prefKey: 'pref-framework-sveltekit', description: 'SvelteKit' },
  'express': { prefKey: 'pref-framework-express', description: 'Express.js for Node backend' },
  'fastify': { prefKey: 'pref-framework-fastify', description: 'Fastify for Node backend' },
  'hono': { prefKey: 'pref-framework-hono', description: 'Hono for edge/serverless' },
  'koa': { prefKey: 'pref-framework-koa', description: 'Koa for Node backend' },
  'remix': { prefKey: 'pref-framework-remix', description: 'Remix for full-stack React' },
  'astro': { prefKey: 'pref-framework-astro', description: 'Astro for content sites' },
  'gatsby': { prefKey: 'pref-framework-gatsby', description: 'Gatsby for static React sites' },
  // Frontend libraries
  'react': { prefKey: 'pref-framework-react', description: 'React' },
  'vue': { prefKey: 'pref-framework-vue', description: 'Vue.js' },
  'angular': { prefKey: 'pref-framework-angular', description: 'Angular' },
  '@angular/core': { prefKey: 'pref-framework-angular', description: 'Angular' },
  'solid-js': { prefKey: 'pref-framework-solidjs', description: 'SolidJS' },
  // CSS/style
  'tailwindcss': { prefKey: 'pref-style-tailwind', description: 'Tailwind CSS' },
  'bootstrap': { prefKey: 'pref-style-bootstrap', description: 'Bootstrap' },
  'styled-components': { prefKey: 'pref-style-styled-components', description: 'styled-components (CSS-in-JS)' },
  '@emotion/react': { prefKey: 'pref-style-emotion', description: 'Emotion (CSS-in-JS)' },
  'sass': { prefKey: 'pref-style-sass', description: 'Sass/SCSS' },
  // Testing
  'vitest': { prefKey: 'pref-tool-vitest', description: 'Vitest for testing' },
  'jest': { prefKey: 'pref-tool-jest', description: 'Jest for testing' },
  'mocha': { prefKey: 'pref-tool-mocha', description: 'Mocha for testing' },
  'playwright': { prefKey: 'pref-tool-playwright', description: 'Playwright for E2E testing' },
  '@playwright/test': { prefKey: 'pref-tool-playwright', description: 'Playwright for E2E testing' },
  'cypress': { prefKey: 'pref-tool-cypress', description: 'Cypress for E2E testing' },
  // Build/bundlers
  'vite': { prefKey: 'pref-tool-vite', description: 'Vite for bundling' },
  'webpack': { prefKey: 'pref-tool-webpack', description: 'Webpack for bundling' },
  'esbuild': { prefKey: 'pref-tool-esbuild', description: 'esbuild for bundling' },
  'turbo': { prefKey: 'pref-tool-turbo', description: 'Turborepo for monorepo' },
  // ORM/DB
  'drizzle-orm': { prefKey: 'pref-tool-drizzle', description: 'Drizzle ORM' },
  'prisma': { prefKey: 'pref-tool-prisma', description: 'Prisma ORM' },
  '@prisma/client': { prefKey: 'pref-tool-prisma', description: 'Prisma ORM' },
  'mongoose': { prefKey: 'pref-tool-mongoose', description: 'Mongoose for MongoDB' },
  'typeorm': { prefKey: 'pref-tool-typeorm', description: 'TypeORM' },
  'sequelize': { prefKey: 'pref-tool-sequelize', description: 'Sequelize ORM' },
  'knex': { prefKey: 'pref-tool-knex', description: 'Knex.js query builder' },
  // Linting/formatting
  'eslint': { prefKey: 'pref-tool-eslint', description: 'ESLint for linting' },
  'biome': { prefKey: 'pref-tool-biome', description: 'Biome for linting/formatting' },
  '@biomejs/biome': { prefKey: 'pref-tool-biome', description: 'Biome for linting/formatting' },
  'prettier': { prefKey: 'pref-tool-prettier', description: 'Prettier for formatting' },
  // State management
  'zustand': { prefKey: 'pref-tool-zustand', description: 'Zustand for state management' },
  'redux': { prefKey: 'pref-tool-redux', description: 'Redux for state management' },
  '@reduxjs/toolkit': { prefKey: 'pref-tool-redux', description: 'Redux Toolkit' },
  'jotai': { prefKey: 'pref-tool-jotai', description: 'Jotai for atomic state' },
  // Auth
  'next-auth': { prefKey: 'pref-tool-nextauth', description: 'NextAuth.js for authentication' },
  '@auth/core': { prefKey: 'pref-tool-authjs', description: 'Auth.js for authentication' },
  'lucia': { prefKey: 'pref-tool-lucia', description: 'Lucia for authentication' },
  'passport': { prefKey: 'pref-tool-passport', description: 'Passport.js for auth' },
};

// Config filenames → deployment preferences
const DEPLOY_CONFIG_MAP: Record<string, { prefKey: string; description: string }> = {
  'wrangler.toml': { prefKey: 'pref-deploy-cloudflare', description: 'Cloudflare Workers via wrangler' },
  'wrangler.jsonc': { prefKey: 'pref-deploy-cloudflare', description: 'Cloudflare Workers via wrangler' },
  'wrangler.json': { prefKey: 'pref-deploy-cloudflare', description: 'Cloudflare Workers via wrangler' },
  'vercel.json': { prefKey: 'pref-deploy-vercel', description: 'Vercel for deployment' },
  'netlify.toml': { prefKey: 'pref-deploy-netlify', description: 'Netlify for deployment' },
  'fly.toml': { prefKey: 'pref-deploy-fly', description: 'Fly.io for deployment' },
  'render.yaml': { prefKey: 'pref-deploy-render', description: 'Render for deployment' },
  'Dockerfile': { prefKey: 'pref-deploy-docker', description: 'Docker containers' },
  'docker-compose.yml': { prefKey: 'pref-deploy-docker-compose', description: 'Docker Compose' },
  'docker-compose.yaml': { prefKey: 'pref-deploy-docker-compose', description: 'Docker Compose' },
  'serverless.yml': { prefKey: 'pref-deploy-serverless', description: 'Serverless Framework' },
  'serverless.yaml': { prefKey: 'pref-deploy-serverless', description: 'Serverless Framework' },
  'sam.yaml': { prefKey: 'pref-deploy-aws-sam', description: 'AWS SAM' },
  'template.yaml': { prefKey: 'pref-deploy-aws-sam', description: 'AWS SAM' },
  'cdk.json': { prefKey: 'pref-deploy-aws-cdk', description: 'AWS CDK' },
  'app.yaml': { prefKey: 'pref-deploy-gcloud', description: 'Google Cloud App Engine' },
  'firebase.json': { prefKey: 'pref-deploy-firebase', description: 'Firebase' },
  'railway.json': { prefKey: 'pref-deploy-railway', description: 'Railway for deployment' },
  'Procfile': { prefKey: 'pref-deploy-heroku', description: 'Heroku' },
};

/**
 * Extract structured memories from tool_use events (file writes/edits).
 * Zero API calls — pure parsing.
 */
export function extractStructural(toolEvents: ToolEvent[]): StructuralMemory[] {
  const memories: StructuralMemory[] = [];

  for (const event of toolEvents) {
    if (event.tool !== 'Write' && event.tool !== 'Edit') continue;

    const filePath = (event.input.file_path as string) ?? '';
    const content = (event.input.content as string) ?? (event.input.new_string as string) ?? '';

    if (!filePath || !content) continue;

    // CSS/design tokens
    const cssMemories = extractCSSVariables(filePath, content);
    memories.push(...cssMemories);

    // Package.json dependencies
    const depMemories = extractDependencies(filePath, content);
    memories.push(...depMemories);

    // Config files
    const configMemories = extractConfigDecisions(filePath, content);
    memories.push(...configMemories);

    // API routes
    const routeMemories = extractRouteDefinitions(filePath, content);
    memories.push(...routeMemories);

    // Tech preferences (global scope)
    const prefMemories = extractTechPreferences(filePath, content);
    memories.push(...prefMemories);
  }

  // Deduplicate by key
  const seen = new Map<string, StructuralMemory>();
  for (const mem of memories) {
    const existing = seen.get(mem.key);
    if (!existing || mem.confidence > existing.confidence) {
      seen.set(mem.key, mem);
    }
  }

  return Array.from(seen.values());
}

function extractCSSVariables(filePath: string, content: string): StructuralMemory[] {
  if (!/\.(css|scss|sass|less)$/.test(filePath) && !/tailwind/.test(filePath)) {
    return [];
  }

  const memories: StructuralMemory[] = [];
  const varPattern = /--([\w-]+)\s*:\s*([^;]+)/g;
  let match: RegExpExecArray | null;
  const vars: string[] = [];

  while ((match = varPattern.exec(content)) !== null) {
    vars.push(`--${match[1]}: ${match[2].trim()}`);
  }

  if (vars.length > 0) {
    memories.push({
      category: 'design',
      key: `css-variables-${basename(filePath)}`,
      value: vars.slice(0, 10).join(', '), // Cap at 10 vars
      confidence: 1.0,
      source: filePath,
    });
  }

  // Tailwind theme colors
  const themeColorPattern = /(?:colors?|primary|secondary|accent)\s*[:{]\s*['"]?(#[\da-fA-F]+|[\w-]+)['"]?/g;
  const themeColors: string[] = [];
  while ((match = themeColorPattern.exec(content)) !== null) {
    themeColors.push(match[0].trim());
  }

  if (themeColors.length > 0) {
    memories.push({
      category: 'design',
      key: `theme-colors-${basename(filePath)}`,
      value: themeColors.slice(0, 5).join(', '),
      confidence: 0.9,
      source: filePath,
    });
  }

  return memories;
}

function extractDependencies(filePath: string, content: string): StructuralMemory[] {
  if (!filePath.endsWith('package.json')) return [];

  const memories: StructuralMemory[] = [];

  try {
    const pkg = JSON.parse(content);

    if (pkg.dependencies) {
      const deps = Object.entries(pkg.dependencies as Record<string, string>)
        .map(([name, version]) => `${name}@${version}`)
        .slice(0, 15);

      if (deps.length > 0) {
        memories.push({
          category: 'architecture',
          key: 'dependencies',
          value: deps.join(', '),
          confidence: 1.0,
          source: filePath,
        });
      }
    }

    if (pkg.devDependencies) {
      const devDeps = Object.entries(pkg.devDependencies as Record<string, string>)
        .map(([name, version]) => `${name}@${version}`)
        .slice(0, 10);

      if (devDeps.length > 0) {
        memories.push({
          category: 'tooling',
          key: 'dev-dependencies',
          value: devDeps.join(', '),
          confidence: 1.0,
          source: filePath,
        });
      }
    }
  } catch {
    // Not valid JSON
  }

  return memories;
}

function extractConfigDecisions(filePath: string, content: string): StructuralMemory[] {
  const file = basename(filePath);
  if (!CONFIG_FILES.has(file) && !CONFIG_FILES.has(filePath)) return [];

  const memories: StructuralMemory[] = [];

  // For JSON configs, extract key top-level decisions
  if (file.endsWith('.json') || file.endsWith('.jsonc')) {
    try {
      const config = JSON.parse(content.replace(/\/\/.*$/gm, '')); // Strip comments
      const summary = summarizeConfig(file, config);
      if (summary) {
        memories.push({
          category: 'config',
          key: `config-${file.replace(/\./g, '-')}`,
          value: summary,
          confidence: 1.0,
          source: filePath,
        });
      }
    } catch {
      // Not valid JSON
    }
  } else {
    // For non-JSON configs, just note that it was created/modified
    memories.push({
      category: 'config',
      key: `config-${file.replace(/\./g, '-')}`,
      value: `${file} configured`,
      confidence: 0.7,
      source: filePath,
    });
  }

  return memories;
}

function extractRouteDefinitions(filePath: string, content: string): StructuralMemory[] {
  if (!/(?:route|endpoint|api|controller)/i.test(filePath)) return [];

  const memories: StructuralMemory[] = [];
  const routePatterns = [
    /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gi, // Next.js App Router
  ];

  const routes: string[] = [];
  for (const pattern of routePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      routes.push(`${match[1].toUpperCase()} ${match[2] ?? filePath}`);
    }
  }

  if (routes.length > 0) {
    memories.push({
      category: 'api',
      key: `routes-${basename(filePath)}`,
      value: routes.slice(0, 10).join(', '),
      confidence: 0.9,
      source: filePath,
    });
  }

  return memories;
}

function summarizeConfig(filename: string, config: Record<string, unknown>): string {
  if (filename === 'tsconfig.json' || filename === 'tsconfig.base.json') {
    const opts = config.compilerOptions as Record<string, unknown> | undefined;
    if (!opts) return '';
    const parts: string[] = [];
    if (opts.target) parts.push(`target: ${opts.target}`);
    if (opts.module) parts.push(`module: ${opts.module}`);
    if (opts.jsx) parts.push(`jsx: ${opts.jsx}`);
    if (opts.strict) parts.push('strict mode');
    return parts.join(', ');
  }

  // Generic: report top-level keys
  const keys = Object.keys(config).slice(0, 5);
  return `keys: ${keys.join(', ')}`;
}

function extractTechPreferences(filePath: string, content: string): StructuralMemory[] {
  const memories: StructuralMemory[] = [];
  const file = basename(filePath);

  // From package.json: detect framework/tool preferences
  if (file === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      for (const depName of Object.keys(allDeps)) {
        const match = FRAMEWORK_MAP[depName];
        if (match) {
          memories.push({
            category: 'preferences',
            key: match.prefKey,
            value: `Uses ${match.description}`,
            confidence: 0.6,
            source: filePath,
            scope: 'global',
          });
        }
      }

      // Detect TypeScript preference
      if (allDeps['typescript']) {
        memories.push({
          category: 'preferences',
          key: 'pref-lang-typescript',
          value: 'Uses TypeScript for Node.js projects',
          confidence: 0.6,
          source: filePath,
          scope: 'global',
        });
      }
    } catch {
      // Not valid JSON
    }
  }

  // Python project files
  if (file === 'requirements.txt' || file === 'pyproject.toml' || file === 'setup.py' || file === 'Pipfile') {
    memories.push({
      category: 'preferences',
      key: 'pref-lang-python',
      value: 'Uses Python',
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });

    // Detect Python frameworks from requirements
    if (file === 'requirements.txt' || file === 'pyproject.toml') {
      if (/\bdjango\b/i.test(content)) {
        memories.push({ category: 'preferences', key: 'pref-framework-django', value: 'Uses Django for Python web', confidence: 0.6, source: filePath, scope: 'global' });
      }
      if (/\bflask\b/i.test(content)) {
        memories.push({ category: 'preferences', key: 'pref-framework-flask', value: 'Uses Flask for Python web', confidence: 0.6, source: filePath, scope: 'global' });
      }
      if (/\bfastapi\b/i.test(content)) {
        memories.push({ category: 'preferences', key: 'pref-framework-fastapi', value: 'Uses FastAPI for Python APIs', confidence: 0.6, source: filePath, scope: 'global' });
      }
      if (/\btorch\b|\bpytorch\b/i.test(content)) {
        memories.push({ category: 'preferences', key: 'pref-framework-pytorch', value: 'Uses PyTorch for ML', confidence: 0.6, source: filePath, scope: 'global' });
      }
      if (/\btensorflow\b/i.test(content)) {
        memories.push({ category: 'preferences', key: 'pref-framework-tensorflow', value: 'Uses TensorFlow for ML', confidence: 0.6, source: filePath, scope: 'global' });
      }
    }
  }

  // Ruby project files
  if (file === 'Gemfile') {
    memories.push({
      category: 'preferences',
      key: 'pref-lang-ruby',
      value: 'Uses Ruby',
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });
    if (/\brails\b/i.test(content)) {
      memories.push({ category: 'preferences', key: 'pref-framework-rails', value: 'Uses Ruby on Rails', confidence: 0.6, source: filePath, scope: 'global' });
    }
  }

  // PHP project files
  if (file === 'composer.json') {
    memories.push({
      category: 'preferences',
      key: 'pref-lang-php',
      value: 'Uses PHP',
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });
    if (/laravel/i.test(content)) {
      memories.push({ category: 'preferences', key: 'pref-framework-laravel', value: 'Uses Laravel for PHP', confidence: 0.6, source: filePath, scope: 'global' });
    }
  }

  // Go project files
  if (file === 'go.mod') {
    memories.push({
      category: 'preferences',
      key: 'pref-lang-go',
      value: 'Uses Go',
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });
  }

  // Rust project files
  if (file === 'Cargo.toml') {
    memories.push({
      category: 'preferences',
      key: 'pref-lang-rust',
      value: 'Uses Rust',
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });
  }

  // Deployment config files
  const deployMatch = DEPLOY_CONFIG_MAP[file];
  if (deployMatch) {
    memories.push({
      category: 'preferences',
      key: deployMatch.prefKey,
      value: `Uses ${deployMatch.description}`,
      confidence: 0.6,
      source: filePath,
      scope: 'global',
    });
  }

  return memories;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
