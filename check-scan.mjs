import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderMathInHtml } from './src/utils/mathRender.ts';
const root = 'src/content/notes';
let files = 0, errs = 0, lits = 0;
for (const s of readdirSync(root))
  for (const d of readdirSync(join(root, s)))
    for (const h of readdirSync(join(root, s, d)).filter((f) => f.endsWith('.html'))) {
      const out = renderMathInHtml(readFileSync(join(root, s, d, h), 'utf8'));
      files++;
      errs += (out.match(/katex-error/g) || []).length;
      lits += (out.match(/bn-math-literal/g) || []).length;
      if (/(katex-error|bn-math-literal)/.test(out))
        console.log('ISSUE:', s, '/', d);
    }
console.log('files:', files, '| katex-error:', errs, '| literals:', lits);
