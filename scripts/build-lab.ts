// 將引擎放入試算頁，出 lab/dist/scoring-lab.html（一個獨立 HTML，可以直接開）
import { readFileSync, writeFileSync } from 'node:fs';

const engine = readFileSync(new URL('../lab/dist/engine.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../lab/page.html', import.meta.url), 'utf8');
if (!page.includes('/*ENGINE*/')) throw new Error('page.html 冇 /*ENGINE*/ 位');
writeFileSync(new URL('../lab/dist/scoring-lab.html', import.meta.url), page.replace('/*ENGINE*/', () => engine));
console.log('lab/dist/scoring-lab.html OK');
