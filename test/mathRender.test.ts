import { describe, it, expect } from 'vitest';
import { renderMathInHtml, renderMathInline, containsMath } from '../src/utils/mathRender';

describe('renderMathInHtml', () => {
  it('renders inline \(...\) math to KaTeX HTML', () => {
    const out = renderMathInHtml('<p>The value of \\(E = mc^2\\) is key.</p>');
    expect(out).toContain('class="katex');
    expect(out).not.toContain('\\(');
  });

  it('renders display \[...\] math as katex-display', () => {
    const out = renderMathInHtml('<p>\\[x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\\]</p>');
    expect(out).toContain('class="katex-display');
    expect(out).toContain('katex-html');
  });

  it('renders $$...$$ display math', () => {
    const out = renderMathInHtml('<p>$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$</p>');
    expect(out).toContain('class="katex-display');
    expect(out).not.toContain('$$');
  });

  it('renders conservative $...$ inline math', () => {
    const out = renderMathInHtml('<p>Here $x + y$ sums.</p>');
    expect(out).toContain('class="katex');
  });

  it('does NOT treat currency amounts or digit-led text as math', () => {
    const out = renderMathInHtml('<p>Cost: $5.99 and $100 total.</p>');
    expect(out).not.toContain('class="katex');
    expect(out).toContain('$5.99');
  });

  it('does NOT render math inside <pre> or <code> blocks', () => {
    const html = '<pre>\\(not math\\)</pre><code>$also not$</code>';
    const out = renderMathInHtml(html);
    expect(out).not.toContain('class="katex');
    expect(out).toContain('\\(not math\\)');
    expect(out).toContain('$also not$');
  });

  it('is idempotent — already-converted content is returned unchanged', () => {
    const converted = renderMathInHtml('<p>\\(a + b\\)</p>');
    const again = renderMathInHtml(converted);
    expect(again).toBe(converted);
  });

  it('leaves non-math HTML untouched', () => {
    const html = '<p><strong>bold</strong> and <em>em</em></p>';
    expect(renderMathInHtml(html)).toBe(html);
  });

  it('handles escaped dollar signs as literal text', () => {
    const out = renderMathInHtml('<p>Price is \\$5</p>');
    expect(out).not.toContain('class="katex');
    expect(out).toContain('$5');
  });

  it('handles multi-line display math spanning paragraphs', () => {
    const out = renderMathInHtml('<p>$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$</p>');
    expect(out).toContain('class="katex-display');
  });

  it('keeps display math inside escaped brackets (E\\[X\\] pattern)', () => {
    const out = renderMathInHtml('<p>\\[ \\mu = E\\[X\\] = 0 \\cdot q + 1 \\cdot p \\]</p>');
    expect(out).toContain('katex-display');
    expect(out).not.toContain('\\[');
  });

  it('handles \\\\[4pt] line-break spacing (not a math delimiter)', () => {
    const out = renderMathInHtml('<p>\\[ \\begin{aligned} a &= b \\\\[4pt] c &= d \\end{aligned} \\]</p>');
    expect(out).toContain('katex-display');
  });

  it('decodes HTML entities inside math (MathJax did implicitly)', () => {
    const out = renderMathInHtml('<p>\\(t_k &lt; t\\)</p>');
    expect(out).toContain('class="katex');
  });

  it('renders \\lt inside \\text{} groups (NLP <s> tokens)', () => {
    const out = renderMathInHtml('<p>\\(P(\\text{I} \\mid \\text{\\lt s\\gt}) = 0.25\\)</p>');
    expect(out).toContain('class="katex');
    expect(out).not.toContain('bn-math-literal');
  });

  it('handles raw < and > in math (MathJax accepted them)', () => {
    const out = renderMathInHtml('<p>\\[ z \\begin{cases} 0 & z < 0 \\end{cases} \\]</p>');
    expect(out).toContain('katex-display');
  });

  it('reconstructs control-char-mangled commands (\\right, \\begin, \\alpha)', () => {
    const mangled = '<p>\\(V(S_t) \\leftarrow V(S_t) + \\' + String.fromCharCode(7) + 'lpha\\)</p>';
    const out = renderMathInHtml(mangled);
    expect(out).toContain('class="katex');
    expect(out).not.toContain('bn-math-literal');
  });

  it('falls back to literal text instead of red error boxes for corrupt formulas', () => {
    const out = renderMathInHtml('<p>\\(\\frac{2}{\\W\\}}\\)</p>');
    expect(out).not.toContain('katex-error');
    expect(out).toContain('bn-math-literal');
  });
});

describe('renderMathInline', () => {
  it('renders math delimiters in plain text strings', () => {
    expect(renderMathInline('What is \\(\\pi\\)?')).toContain('class="katex');
  });

  it('no-ops on plain text', () => {
    const text = 'What is the discount factor?';
    expect(renderMathInline(text)).toBe(text);
  });

  it('wraps bare formulas in display math when no delimiter exists', () => {
    expect(renderMathInline('\\[E = mc^2\\]')).toContain('katex-display');
  });
});

describe('containsMath', () => {
  it('detects delimiters', () => {
    expect(containsMath('see \\(x\\)')).toBe(true);
    expect(containsMath('$$x$$')).toBe(true);
    expect(containsMath('no math here')).toBe(false);
  });
});
