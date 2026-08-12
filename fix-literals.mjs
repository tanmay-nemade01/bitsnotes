import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'src/content/notes/Deep Reinforcement Learning/DRL_Lecture_11_notes/DRL_Lecture_11_notes.html',
  'src/content/notes/Introduction to Statistical Methods/ISM_Lecture_15_notes/ISM_Lecture_15_notes.html',
];

const fixes = [
  ['\u0007lpha', '\\alpha'],   // BEL+`lpha`  <- mangled \alpha
  ['\u0007rg', '\\arg'],       // BEL+`rg`    <- mangled \arg
  ['\u0008eta', '\\beta'],     // BS+`eta`    <- mangled \beta
  ['\u0008oldsymbol', '\\boldsymbol'], // BS+`oldsymbol` <- mangled \boldsymbol
  ['\u0009ext', '\\text'],     // TAB+`ext`   <- mangled \text
  ['\u0009imes', '\\times'],   // TAB+`imes`  <- mangled \times
  ['\u000Crac', '\\frac'],     // FF+`rac`    <- mangled \frac
  ['\r\night', '\\right'],     // CRLF+`ight` <- mangled \right
  ['\r\nabla', '\\nabla'],     // CRLF+`abla` <- mangled \nabla
];

for (const f of files) {
  const name = f.split('/').pop();
  let s = readFileSync(f, 'utf8');
  for (const [from, to] of fixes) {
    const count = s.split(from).length - 1;
    if (count > 0) console.log(name, JSON.stringify(from), '->', to, 'x' + count);
    s = s.split(from).join(to);
  }
  const leftover = [...s.matchAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|(\r)(?!\n)/g)];
  if (leftover.length) {
    console.log(name, 'LEFTOVER CONTROL CHARS:', leftover.length);
    for (const m of leftover) {
      const c = m[0];
      const code = c.charCodeAt(0).toString(16);
      console.log('  ', code, JSON.stringify(s.slice(m.index - 12, m.index + 12)));
    }
  } else {
    console.log(name, 'OK - no remaining stray control chars');
  }
  writeFileSync(f, s);
}
