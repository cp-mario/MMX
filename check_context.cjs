// Show the context of `class="folder-list"` in a few false-positive pages
const fs = require('fs');
const files = [
  'c:/Users/cpmar/Documents/MMX/1Example/output/pages/text-formatting.html',
  'c:/Users/cpmar/Documents/MMX/1Example/output/pages/examples/code-example.html',
  'c:/Users/cpmar/Documents/MMX/1Example/output/pages/lists.html',
];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const idx = t.indexOf('class="folder-list"');
  console.log('==='+f+'===');
  if (idx === -1) { console.log('NOT FOUND'); continue; }
  // Get up to 5 hits
  let i = idx, n = 0;
  while (i !== -1 && n < 3) {
    console.log('--- hit at', i, '---');
    console.log(t.slice(Math.max(0, i - 200), i + 300));
    i = t.indexOf('class="folder-list"', i + 1);
    n++;
  }
  console.log();
}
