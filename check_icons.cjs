// Diagnostic: for every generated HTML page, count occurrences of
// `class="folder-list"` and `class="folder-list-icon "`. Then print
// pages where the link is loaded but no icon is used.
const fs = require('fs');
const path = require('path');

const root = 'c:/Users/cpmar/Documents/MMX/1Example/output';

function walk(d) {
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) out = out.concat(walk(p));
    else if (f.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const pages = walk(root);
const buckets = { withLinkUsesIcon: [], withLinkNoIcon: [], noLink: [] };
for (const p of pages) {
  const t = fs.readFileSync(p, 'utf8');
  const hasLink = t.includes('folderIndexIcons.css');
  const usesIcon = t.includes('class="folder-list-icon ');
  if (hasLink && usesIcon) buckets.withLinkUsesIcon.push(p);
  else if (hasLink && !usesIcon) buckets.withLinkNoIcon.push(p);
  else if (!hasLink) buckets.noLink.push(p);
}
console.log('with link AND uses icon:', buckets.withLinkUsesIcon.length);
console.log('with link BUT no icon use:', buckets.withLinkNoIcon.length);
console.log('no link:', buckets.noLink.length);
console.log();
console.log('=== pages that load the link but DO NOT use the icon ===');
buckets.withLinkNoIcon.forEach(p => console.log('  ' + p.replace(root + '\\', '')));
