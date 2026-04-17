#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  create-i-am-ios-app  —  interactive project scaffolder
//  Usage:
//    npx create-i-am-ios-app
//    npx create-i-am-ios-app my-app
//    npx create-i-am-ios-app my-app --template react
//    node packages/create-i-am-ios-app/index.js --dry-run
// ════════════════════════════════════════════════════════════════════════════

import fs       from 'node:fs';
import path     from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const TEMPLATES = ['vanilla', 'react', 'vue', 'svelte'];
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW= '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD  = '\x1b[1m';

function log(msg)  { process.stdout.write(msg + '\n'); }
function info(msg) { log(`${CYAN}ℹ${RESET}  ${msg}`); }
function ok(msg)   { log(`${GREEN}✓${RESET}  ${msg}`); }
function warn(msg) { log(`${YELLOW}!${RESET}  ${msg}`); }

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Template definitions ──────────────────────────────────────────────────────

const BASE_PACKAGE = (name, template) => JSON.stringify({
  name,
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    dev:   template === 'react' ? 'vite' : 'node server.js',
    build: template === 'react' ? 'vite build' : 'echo "No build step"',
    start: 'node server.js',
  },
  dependencies: {
    '@i-am-ios/sdk': '^2.0.0',
    ...(template === 'react'  ? { react: '^18.0.0', 'react-dom': '^18.0.0' } : {}),
    ...(template === 'vue'    ? { vue: '^3.4.0' }   : {}),
    ...(template === 'svelte' ? { svelte: '^4.0.0' }: {}),
  },
  devDependencies: {
    ...(template === 'react' ? { vite: '^5.0.0', '@vitejs/plugin-react': '^4.0.0' } : {}),
  },
}, null, 2);

const VANILLA_HTML = (name) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
</head>
<body>
  <div id="app">
    <h1>${name}</h1>
    <p id="status">Initializing sovereign log…</p>
    <ul id="events"></ul>
  </div>
  <script type="module">
    import { SovereignLog, EVENT_TYPES } from 'https://cdn.jsdelivr.net/npm/@i-am-ios/sdk/dist/index.js';

    const log = new SovereignLog();
    log.subscribe((state, record) => {
      document.getElementById('status').textContent =
        'Events: ' + state.eventCount + ' | Head: ' + state.headHash;
      if (record) {
        const li = document.createElement('li');
        li.textContent = '[' + record.type + '] ' + JSON.stringify(record.payload ?? {});
        document.getElementById('events').prepend(li);
      }
    });

    log.emit('TAB_CHANGED', { tab: 'home' });
    log.emit('MODEL_SELECTED', { model: 'llama3' });
  </script>
</body>
</html>
`;

const REACT_MAIN = () => `import React from 'react';
import { createRoot } from 'react-dom/client';
import { SovereignProvider, useSovereign } from '@i-am-ios/sdk/react';

function App() {
  const { state, emit } = useSovereign();
  return (
    <div>
      <h1>I-AM-IOS App</h1>
      <p>Events: {state.eventCount} | Head: {state.headHash}</p>
      <button onClick={() => emit('MODEL_SELECTED', { model: 'llama3' })}>
        Emit Event
      </button>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <SovereignProvider>
    <App />
  </SovereignProvider>
);
`;

const ENV_EXAMPLE = `# Validator endpoint (leave empty for pure P2P mode)
VITE_VALIDATOR_ENDPOINT=
VALIDATOR_ENDPOINT=
PORT=3000
`;

// ── Scaffold function ─────────────────────────────────────────────────────────

function scaffold(targetDir, name, template, dryRun) {
  const write = (relPath, content) => {
    if (dryRun) { log(`  [dry-run] write ${relPath}`); return; }
    const abs = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  };

  write('package.json',  BASE_PACKAGE(name, template));
  write('.env.example',  ENV_EXAMPLE);
  write('.gitignore',    'node_modules/\ndist/\n.env\n');

  if (template === 'vanilla') {
    write('index.html', VANILLA_HTML(name));
  } else if (template === 'react') {
    write('index.html', `<!DOCTYPE html>\n<html><head><title>${name}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`);
    write('src/main.jsx', REACT_MAIN());
    write('vite.config.js', `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`);
  } else if (template === 'vue') {
    write('index.html', `<!DOCTYPE html>\n<html><head><title>${name}</title></head>\n<body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`);
    write('src/main.js', `import { createApp } from 'vue';\nimport { useSovereignLog } from '@i-am-ios/sdk/vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n`);
    write('src/App.vue', `<template>\n  <div><h1>${name}</h1><p>Events: {{ state.eventCount }}</p></div>\n</template>\n<script setup>\nimport { useSovereignLog } from '@i-am-ios/sdk/vue';\nconst { state, emit } = useSovereignLog();\n</script>\n`);
  } else if (template === 'svelte') {
    write('index.html', `<!DOCTYPE html>\n<html><head><title>${name}</title></head>\n<body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>`);
    write('src/main.js', `import App from './App.svelte';\nconst app = new App({ target: document.getElementById('app') });\nexport default app;\n`);
    write('src/App.svelte', `<script>\nimport { createSovereignLog } from '@i-am-ios/sdk/svelte';\nconst { subscribe, emit } = createSovereignLog();\nlet state = {};\nsubscribe(s => { state = s; });\n</script>\n<h1>${name}</h1>\n<p>Events: {state.eventCount ?? 0}</p>\n`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const tmplFlag = args.find(a => a.startsWith('--template='))?.split('=')[1]
                || (args.indexOf('--template') >= 0 ? args[args.indexOf('--template') + 1] : null);

  log('');
  log(`${BOLD}${CYAN}create-i-am-ios-app${RESET} — Sovereign Identity OS scaffolder`);
  log('');

  let projectName = args.find(a => !a.startsWith('--'));
  if (!projectName && !dryRun) {
    projectName = await prompt('Project name: (my-sovereign-app) ') || 'my-sovereign-app';
  }
  projectName = projectName || 'my-sovereign-app';

  let template = tmplFlag;
  if (!template && !dryRun) {
    const t = await prompt(`Template [${TEMPLATES.join('/')}]: (vanilla) `) || 'vanilla';
    template = TEMPLATES.includes(t) ? t : 'vanilla';
  }
  template = template || 'vanilla';

  if (!TEMPLATES.includes(template)) {
    warn(`Unknown template "${template}". Falling back to vanilla.`);
    template = 'vanilla';
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  if (!dryRun && fs.existsSync(targetDir)) {
    warn(`Directory "${projectName}" already exists.`);
    const overwrite = await prompt('Overwrite? (y/N) ');
    if (overwrite.toLowerCase() !== 'y') { process.exit(0); }
  }

  info(`Scaffolding ${BOLD}${projectName}${RESET} (${template} template)…`);
  if (!dryRun) fs.mkdirSync(targetDir, { recursive: true });

  scaffold(targetDir, projectName, template, dryRun);

  ok(`Created ${projectName}`);
  log('');
  log('Next steps:');
  log(`  cd ${projectName}`);
  log('  npm install');
  log('  npm run dev');
  log('');
}

main().catch(err => { console.error(err); process.exit(1); });
