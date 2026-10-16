// 將 src/engine 砌成瀏覽器用嘅 lab/dist/engine.js（全域 MJEngine），唔使額外套件。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const files = ['rules.ts', 'chips.ts', 'table.ts', 'settlement.ts'];
const names: string[] = [];
const parts: string[] = [];

for (const f of files) {
  const src = readFileSync(new URL(`../src/engine/${f}`, import.meta.url), 'utf8');
  let js = stripTypeScriptTypes(src, { mode: 'strip' });
  js = js.replace(/^import\s[^;]*;\s*$/gm, '');
  js = js.replace(/^export\s+(const|function|class)\s+(\w+)/gm, (_m, kind: string, name: string) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  parts.push(`// ${f}\n${js}`);
}

const out = `/* 雀簿計分引擎 */\nvar MJEngine = (function () {\n'use strict';\n${parts.join('\n')}\nreturn { ${names.join(', ')} };\n})();\n`;
mkdirSync(new URL('../lab/dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../lab/dist/engine.js', import.meta.url), out);
console.log(`lab/dist/engine.js：${names.length} 個 export`);
