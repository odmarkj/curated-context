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
/**
 * Extract structured memories from tool_use events (file writes/edits).
 * Zero API calls — pure parsing.
 */
export function extractStructural(toolEvents) {
    const memories = [];
    for (const event of toolEvents) {
        if (event.tool !== 'Write' && event.tool !== 'Edit')
            continue;
        const filePath = event.input.file_path ?? '';
        const content = event.input.content ?? event.input.new_string ?? '';
        if (!filePath || !content)
            continue;
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
    }
    // Deduplicate by key
    const seen = new Map();
    for (const mem of memories) {
        const existing = seen.get(mem.key);
        if (!existing || mem.confidence > existing.confidence) {
            seen.set(mem.key, mem);
        }
    }
    return Array.from(seen.values());
}
function extractCSSVariables(filePath, content) {
    if (!/\.(css|scss|sass|less)$/.test(filePath) && !/tailwind/.test(filePath)) {
        return [];
    }
    const memories = [];
    const varPattern = /--([\w-]+)\s*:\s*([^;]+)/g;
    let match;
    const vars = [];
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
    const themeColors = [];
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
function extractDependencies(filePath, content) {
    if (!filePath.endsWith('package.json'))
        return [];
    const memories = [];
    try {
        const pkg = JSON.parse(content);
        if (pkg.dependencies) {
            const deps = Object.entries(pkg.dependencies)
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
            const devDeps = Object.entries(pkg.devDependencies)
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
    }
    catch {
        // Not valid JSON
    }
    return memories;
}
function extractConfigDecisions(filePath, content) {
    const file = basename(filePath);
    if (!CONFIG_FILES.has(file) && !CONFIG_FILES.has(filePath))
        return [];
    const memories = [];
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
        }
        catch {
            // Not valid JSON
        }
    }
    else {
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
function extractRouteDefinitions(filePath, content) {
    if (!/(?:route|endpoint|api|controller)/i.test(filePath))
        return [];
    const memories = [];
    const routePatterns = [
        /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gi, // Next.js App Router
    ];
    const routes = [];
    for (const pattern of routePatterns) {
        let match;
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
function summarizeConfig(filename, config) {
    if (filename === 'tsconfig.json' || filename === 'tsconfig.base.json') {
        const opts = config.compilerOptions;
        if (!opts)
            return '';
        const parts = [];
        if (opts.target)
            parts.push(`target: ${opts.target}`);
        if (opts.module)
            parts.push(`module: ${opts.module}`);
        if (opts.jsx)
            parts.push(`jsx: ${opts.jsx}`);
        if (opts.strict)
            parts.push('strict mode');
        return parts.join(', ');
    }
    // Generic: report top-level keys
    const keys = Object.keys(config).slice(0, 5);
    return `keys: ${keys.join(', ')}`;
}
function basename(filePath) {
    return filePath.split('/').pop() ?? filePath;
}
//# sourceMappingURL=structural.js.map