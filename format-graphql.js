#!/usr/bin/env node
'use strict';

const fs = require('fs');

const PUNCTUATORS = new Set(['!', '$', '&', '(', ')', ':', '=', '@', '[', ']', '{', '|', '}']);

function tokenize(input) {
  const tokens = [];
  const n = input.length;
  let i = 0;

  while (i < n) {
    const c = input[i];

    // --- Normalize double-escaped input -------------------------------
    // If upstream JSON-stringified the query and it wasn't unescaped,
    // the input contains literal `\n`, `\r`, `\t`, `\"` instead of the
    // real characters. Collapse them here, *outside* of strings only,
    // so we don't touch legitimate GraphQL string escapes.
    if (c === '\\' && i + 1 < n) {
      const next = input[i + 1];
      if (next === 'n' || next === 'r' || next === 't') {
        i += 2;              // treat as whitespace
        continue;
      }
      if (next === '"') {
        i += 1;              // let the `"` start a string on next iteration
        continue;
      }
    }
    // ------------------------------------------------------------------

    // Ignored: whitespace, commas, BOM (per GraphQL spec)
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '\uFEFF') {
      i++;
      continue;
    }

    // Comment to end of line
    if (c === '#') {
      let j = i;
      while (j < n && input[j] !== '\n' && input[j] !== '\r') j++;
      tokens.push({ type: 'comment', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Spread
    if (input.startsWith('...', i)) {
      tokens.push({ type: 'punctuator', value: '...' });
      i += 3;
      continue;
    }

    // Block string
    if (input.startsWith('"""', i)) {
      let j = i + 3;
      while (j < n) {
        if (input.startsWith('\\"""', j)) { j += 4; continue; }
        if (input.startsWith('"""', j)) { j += 3; break; }
        j++;
      }
      tokens.push({ type: 'string', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Regular string
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (input[j] === '\\') { j += 2; continue; }
        if (input[j] === '"') { j++; break; }
        j++;
      }
      tokens.push({ type: 'string', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Number
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(input[j])) j++;
      tokens.push({ type: 'number', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Name
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i + 1;
      while (j < n && /[_0-9A-Za-z]/.test(input[j])) j++;
      tokens.push({ type: 'name', value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Punctuator
    if (PUNCTUATORS.has(c)) {
      tokens.push({ type: 'punctuator', value: c });
      i++;
      continue;
    }

    // Unknown char — keep as-is so we never silently drop input
    tokens.push({ type: 'unknown', value: c });
    i++;
  }

  return tokens;
}

const PREV_KEEPS_SAME_LINE = new Set([':', '@', '(', '[', '$', '=', '...', '|', '&']);
const PREV_NAME_KEEPS_SAME_LINE = new Set([
  'query', 'mutation', 'subscription', 'fragment', 'on',
  'type', 'interface', 'input', 'enum', 'union', 'scalar',
  'schema', 'directive', 'extend', 'implements'
]);

function startsNewField(tok, prevTok, groupDepth) {
  if (groupDepth > 0) return false;
  const isName = tok.type === 'name';
  const isSpread = tok.type === 'punctuator' && tok.value === '...';
  if (!isName && !isSpread) return false;
  if (isName && tok.value === 'on') return false;
  if (!prevTok) return true;
  if (prevTok.type === 'punctuator' && PREV_KEEPS_SAME_LINE.has(prevTok.value)) return false;
  if (prevTok.type === 'name' && PREV_NAME_KEEPS_SAME_LINE.has(prevTok.value)) return false;
  return true;
}

function needsSpace(prevTok, curTok) {
  if (!prevTok) return false;
  if (curTok.type === 'punctuator') {
    const cv = curTok.value;
    if (cv === ')' || cv === ']' || cv === ':' || cv === '!' || cv === '(') return false;
  }
  if (prevTok.type === 'punctuator') {
    const pv = prevTok.value;
    if (pv === '(' || pv === '[' || pv === '@' || pv === '$') return false;
  }
  return true;
}

function formatGraphQL(input, indentSize = 2) {
  if (typeof input !== 'string') throw new TypeError('formatGraphQL: input must be a string');

  const tokens = tokenize(input);
  const lines = [];
  let current = '';
  let indent = 0;
  let groupDepth = 0;
  let prev = null;

  const pad = () => ' '.repeat(Math.max(0, indent) * indentSize);
  const flush = () => {
    if (current !== '') {
      lines.push(pad() + current);
      current = '';
    }
  };

  for (const tok of tokens) {
    if (tok.type === 'comment') {
      flush();
      lines.push(pad() + tok.value);
      prev = tok;
      continue;
    }

    if (tok.type === 'punctuator' && tok.value === '{') {
      current = current === '' ? '{' : current + ' {';
      flush();
      indent++;
      prev = tok;
      continue;
    }

    if (tok.type === 'punctuator' && tok.value === '}') {
      flush();
      indent = Math.max(0, indent - 1);
      lines.push(pad() + '}');
      prev = tok;
      continue;
    }

    if (startsNewField(tok, prev, groupDepth)) {
      flush();
    }

    if (current === '') {
      current = tok.value;
    } else if (needsSpace(prev, tok)) {
      current += ' ' + tok.value;
    } else {
      current += tok.value;
    }

    if (tok.type === 'punctuator') {
      if (tok.value === '(' || tok.value === '[') groupDepth++;
      else if (tok.value === ')' || tok.value === ']') groupDepth = Math.max(0, groupDepth - 1);
    }

    prev = tok;
  }

  flush();
  return lines.join('\n');
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  let query;

  if (args.length > 0) {
    const arg = args[0];
    let isFile = false;
    try { isFile = fs.statSync(arg).isFile(); } catch { isFile = false; }
    query = isFile ? fs.readFileSync(arg, 'utf8') : arg;
  } else if (!process.stdin.isTTY) {
    query = await readStdin();
  } else {
    process.stderr.write(
      'Usage:\n' +
      '  node format-graphql.js "<query>"\n' +
      '  node format-graphql.js path/to/query.graphql\n' +
      '  cat query.graphql | node format-graphql.js\n'
    );
    process.exit(1);
  }

  process.stdout.write(formatGraphQL(query) + '\n');
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write((err && err.stack || String(err)) + '\n');
    process.exit(1);
  });
}

module.exports = { formatGraphQL, tokenize };
