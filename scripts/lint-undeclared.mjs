// 우리 lib 이 내보낸 이름을 import 없이 쓰는 곳을 찾는다.
//
// 2026-09-08: audit-event-heroes.mjs 가 `editFrontmatter(raw, { heroImage: DELETE })`
// 를 부르는데 그 둘을 import 하지 않았다(전날 프론트매터 이관 커밋에서 빠졌다).
// 그 줄은 try/catch 안이라 ReferenceError 가 삼켜지고 "could not strip heroImage
// block — fix by hand" 한 줄만 남는다. 즉 **잘못된 사진이 그대로 남는다.**
// reresolve-images.mjs 도 같은 커밋에서 같은 실수를 하고 있었다. 문법 검사는
// 통과하고, 테스트는 그 가지를 밟지 않으며, 저장소에 린터가 없다 — 그래서
// 아무도 못 잡았다.
//
// 정규식으로 먼저 짰다가 버렸다: `for (const [i, day] of …)`, 중첩 템플릿,
// 정규식 리터럴 안의 단어, `import X, { y }` 를 전부 오탐했다. 이제 acorn 으로
// 진짜 파싱해서 **선언된 이름**을 모으고, 어디에도 없는 이름만 남긴다.
//
// 범위는 좁게 유지한다 — 우리 코드가 export 한 이름만 본다. 전역·내장은
// 판정하지 않는다(그건 린터의 일이고, 이 검사의 오탐 없음이 더 중요하다).
//
//   node scripts/lint-undeclared.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';
import { requireExamined } from './lib/examined.mjs';

const DIRS = ['scripts', 'scripts/lib', 'src/lib'];

// 우리 코드가 내보내는 이름 → 어느 모듈이 내보내는지
const exported = new Map();
for (const dir of ['scripts/lib', 'src/lib']) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !x.includes('.test.'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (!exported.has(m[1])) exported.set(m[1], `${dir}/${f}`);
    }
  }
}

const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue;
    walk(node[k], visit);
  }
};

// 패턴(구조분해·기본값·나머지)이 묶는 이름 전부.
function boundNames(pat, out) {
  if (!pat) return out;
  switch (pat.type) {
    case 'Identifier': out.add(pat.name); break;
    case 'ObjectPattern': for (const p of pat.properties) boundNames(p.value ?? p.argument, out); break;
    case 'ArrayPattern': for (const e of pat.elements) boundNames(e, out); break;
    case 'AssignmentPattern': boundNames(pat.left, out); break;
    case 'RestElement': boundNames(pat.argument, out); break;
    default: break;
  }
  return out;
}

let filesScanned = 0;
const unparsable = [];
const hits = [];
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const path = `${dir}/${f}`;
    let ast;
    try {
      ast = parse(readFileSync(path, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true });
    } catch (e) { unparsable.push(`${path} — ${e.message}`); continue; }
    filesScanned++;

    // 이 파일 어디에서든 선언되거나 import 된 이름. 스코프는 따지지 않는다:
    // 이 검사가 답하려는 건 "이 이름이 이 파일에 존재하기는 하는가" 하나다.
    const known = new Set();
    const usedNames = new Map(); // name → 첫 사용 위치
    walk(ast, (n) => {
      switch (n.type) {
        case 'ImportSpecifier': case 'ImportDefaultSpecifier': case 'ImportNamespaceSpecifier':
          known.add(n.local.name); break;
        case 'VariableDeclarator': boundNames(n.id, known); break;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': case 'ClassDeclaration':
          if (n.id) known.add(n.id.name);
          for (const p of n.params ?? []) boundNames(p, known);
          break;
        case 'CatchClause': boundNames(n.param, known); break;
        case 'Property': if (n.shorthand) known.add(n.key.name); break;
        default: break;
      }
    });
    walk(ast, (n) => {
      // 속성 이름(`x.foo`)과 객체 키(`{ foo: 1 }`)는 식별자가 아니다.
      if (n.type === 'MemberExpression' && !n.computed && n.property?.type === 'Identifier') n.property.__prop = true;
      if (n.type === 'Property' && !n.computed && n.key?.type === 'Identifier') n.key.__prop = true;
      // `import { tokens as nameTokens }` 의 `tokens` 는 저쪽 모듈의 이름이지
      // 이 파일이 쓰는 이름이 아니다 — 이걸 사용으로 세면 별칭 import 가 전부
      // 오탐이 된다. 내보내기 쪽 `as` 뒤 이름도 마찬가지.
      if (n.type === 'ImportSpecifier' && n.imported?.type === 'Identifier') n.imported.__prop = true;
      if (n.type === 'ExportSpecifier' && n.exported?.type === 'Identifier') n.exported.__prop = true;
    });
    walk(ast, (n) => {
      if (n.type !== 'Identifier' || n.__prop) return;
      if (!usedNames.has(n.name)) usedNames.set(n.name, n.loc.start.line);
    });

    for (const [name, line] of usedNames) {
      if (known.has(name)) continue;
      const from = exported.get(name);
      if (!from || from === path) continue;
      hits.push({ path, line, name, from });
    }
  }
}

requireExamined(filesScanned, '스크립트 파일');
requireExamined(exported.size, '우리 lib 이 내보낸 이름', 'scripts/lib 을 못 읽었나?');
// 파싱에 실패한 파일을 조용히 건너뛰면 이 검사가 바로 그 부류가 된다.
if (unparsable.length) {
  for (const u of unparsable) console.log(`UNPARSABLE: ${u}`);
  console.log(`\n❌ ${unparsable.length} 파일을 파싱하지 못해 검사하지 못했다.`);
  process.exit(1);
}

for (const h of hits) {
  console.log(`UNDECLARED: ${h.path}:${h.line}  ${h.name} — ${h.from} 이 내보내는 이름인데 import 하지 않았다`);
}
console.log(hits.length
  ? `\n❌ ${hits.length} 곳이 import 없이 우리 이름을 쓴다. 실행되면 ReferenceError 이고, try/catch 안이면 조용히 실패한다.`
  : `✓ ${filesScanned} 파일 · 우리 이름 ${exported.size}개 — import 없이 쓰는 곳 없음.`);
process.exit(hits.length ? 1 : 0);
