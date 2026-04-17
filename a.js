#!/usr/bin/env node

/**
 * Surgical fixer for:
 * - dmr-upgrade config issues
 * - rekernel import + state issues
 * - CommonJS/ESM test mismatch
 */

const fs = require('fs');
const path = require('path');

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function exists(p) {
  return fs.existsSync(p);
}

function logFix(file, msg) {
  console.log(`✔ ${file} → ${msg}`);
}

function logSkip(file, msg) {
  console.log(`… ${file} (skipped: ${msg})`);
}

/* ---------------------------
   FIX 1 — package.json main
----------------------------*/
function fixPackageMain() {
  const file = 'dmr-upgrade/package.json';
  if (!exists(file)) return;

  const pkg = readJSON(file);

  if (pkg.main && pkg.main.endsWith('.ts')) {
    pkg.main = 'dist/routing/overlay-routing.js';
    writeJSON(file, pkg);
    logFix(file, 'main → dist JS');
  } else {
    logSkip(file, 'already correct');
  }
}

/* ---------------------------
   FIX 2 — tsconfig.json
----------------------------*/
function fixTSConfig() {
  const file = 'dmr-upgrade/tsconfig.json';
  if (!exists(file)) return;

  const ts = readJSON(file);
  ts.compilerOptions = ts.compilerOptions || {};

  let changed = false;

  if (ts.compilerOptions.module !== 'CommonJS') {
    ts.compilerOptions.module = 'CommonJS';
    changed = true;
  }

  if (ts.compilerOptions.moduleResolution !== 'node') {
    ts.compilerOptions.moduleResolution = 'node';
    changed = true;
  }

  if (ts.compilerOptions.rootDir !== '.') {
    ts.compilerOptions.rootDir = '.';
    changed = true;
  }

  if (changed) {
    writeJSON(file, ts);
    logFix(file, 'module + resolution + rootDir fixed');
  } else {
    logSkip(file, 'already correct');
  }
}

/* ---------------------------
   FIX 3 — ingress.ts require()
----------------------------*/
function fixIngress() {
  const file = 'rekernel/core/ingress.ts';
  if (!exists(file)) return;

  let content = fs.readFileSync(file, 'utf8');

  if (content.includes("require('../events/event')")) {
    // remove require
    content = content.replace(
      /const\s+\{\s*deriveId\s*\}\s*=\s*require\([^)]+\);?/g,
      ''
    );

    // ensure import exists
    if (!content.includes('deriveId')) {
      content = content.replace(
        /import\s+\{\s*Event\s*\}\s+from\s+['"]..\/events\/event['"];?/,
        `import { Event, deriveId } from '../events/event';`
      );
    } else {
      content = content.replace(
        /import\s+\{\s*Event\s*\}\s+from\s+['"]..\/events\/event['"];?/,
        `import { Event, deriveId } from '../events/event';`
      );
    }

    fs.writeFileSync(file, content);
    logFix(file, 'removed require() → static import');
  } else {
    logSkip(file, 'no require() found');
  }
}

/* ---------------------------
   FIX 4 — chain.ts state shape
----------------------------*/
function fixChainState() {
  const file = 'rekernel/core/chain.ts';
  if (!exists(file)) return;

  let content = fs.readFileSync(file, 'utf8');

  const oldPattern = /memory:\s*\{\}[\s\S]*?budget:\s*\d+,?/;

  if (oldPattern.test(content)) {
    content = content.replace(
      oldPattern,
      `height: 0, version: 1, data: {},`
    );

    fs.writeFileSync(file, content);
    logFix(file, 'State shape updated');
  } else {
    logSkip(file, 'state already modern');
  }
}

/* ---------------------------
   FIX 5 — test-complete-system.js
----------------------------*/
function fixTestFile() {
  const file = 'test-complete-system.js';
  if (!exists(file)) return;

  let content = fs.readFileSync(file, 'utf8');

  if (content.includes('import ') && !content.includes('(async () =>')) {
    const imports = content.match(/^import .*$/gm) || [];

    let transformed = content;

    // remove static imports
    imports.forEach(i => {
      transformed = transformed.replace(i, '');
    });

    // convert to dynamic imports
    const dynamic = imports.map(i => {
      const match = i.match(/import\s+\{([^}]+)\}\s+from\s+['"](.+)['"]/);
      if (!match) return '';

      const vars = match[1].trim();
      const mod = match[2];

      return `const { ${vars} } = await import('${mod}');`;
    }).join('\n');

    transformed = `(async () => {\n${dynamic}\n\n${transformed}\n})();\n`;

    fs.writeFileSync(file, transformed);
    logFix(file, 'converted to dynamic import IIFE');
  } else {
    logSkip(file, 'already compatible');
  }
}

/* ---------------------------
   RUN ALL FIXES
----------------------------*/
function run() {
  console.log('\n🔧 Running surgical fixes...\n');

  fixPackageMain();
  fixTSConfig();
  fixIngress();
  fixChainState();
  fixTestFile();

  console.log('\n✅ Done.\n');
}

run();