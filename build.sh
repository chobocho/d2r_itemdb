#!/usr/bin/env bash
# 배포용 단일 파일 빌드: index.html + app.js + data.json + db_version.json → release/index.html
# 사용법: ./build.sh
# app.js 원본을 수정하지 않기 위해, app.js 보다 먼저 실행되는 fetch 가로채기(shim)가
# ./db_version.json·./data.json 요청에 내장 데이터를 돌려준다 (file:// 로 열어도 동작).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$ROOT/release"

for f in index.html app.js data.json db_version.json; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "오류: 입력 파일 없음 — $f" >&2
    exit 1
  fi
done

command -v node >/dev/null 2>&1 || { echo "오류: node 가 필요합니다" >&2; exit 1; }

# 실패 시 기존 release/ 를 망가뜨리지 않도록 임시 파일에 먼저 생성 후 교체
TMP_OUT="$(mktemp "${TMPDIR:-/tmp}/d2r-release.XXXXXX")"
trap 'rm -f "$TMP_OUT"' EXIT

node - "$ROOT" "$TMP_OUT" <<'NODE'
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [root, outFile] = process.argv.slice(2);
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/^﻿/, '');

const html = read('index.html');
const appJs = read('app.js');
const TAG = '<script src="app.js"></script>';
if (html.split(TAG).length !== 2) {
  console.error('오류: index.html 에서 ' + TAG + ' 태그를 정확히 1개 찾지 못함');
  process.exit(1);
}

// JSON 유효성 확인 겸 원문 텍스트를 그대로 내장 (응답 본문이 원본 파일과 동일하도록)
const embedded = {};
for (const f of ['db_version.json', 'data.json']) {
  const text = read(f);
  JSON.parse(text);
  embedded[f] = text;
}

// '<' 를 유니코드 이스케이프(백슬래시 + u003c)로 치환 — JS 문자열 리터럴 의미는 같고 </script> 조기 종료를 원천 차단
const literal = JSON.stringify(embedded).replace(/</g, '\\u003c');

const shim = `(function () {
    var EMBEDDED = ${literal};
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        // 쿼리스트링(?t=캐시버스터)·해시 제거 후 상대 경로만 매칭 — 절대 URL 은 원래 fetch 로 위임
        var name = url.split('#')[0].split('?')[0].replace(/^\\.\\//, '');
        if (Object.prototype.hasOwnProperty.call(EMBEDDED, name)) {
            return Promise.resolve(new Response(EMBEDDED[name], {
                status: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            }));
        }
        return originalFetch.apply(this, arguments);
    };
})();`;

// app.js 에 '</script' 가 있으면 HTML 파서가 조기 종료하므로 이스케이프 (JS 의미 불변)
const safeAppJs = appJs.replace(/<\/script/gi, '<\\/script');

// split/join 사용 — String.replace 는 app.js 안의 '$&' 등을 치환 패턴으로 해석할 수 있음
const out = html.split(TAG).join(
  '<script id="release-fetch-shim">\n' + shim + '\n</script>\n' +
  '    <script>\n' + safeAppJs + '\n</script>'
);
fs.writeFileSync(outFile, out, 'utf8');
NODE

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
mv "$TMP_OUT" "$OUT_DIR/index.html"
chmod 644 "$OUT_DIR/index.html"
trap - EXIT

echo "빌드 완료: $OUT_DIR/index.html ($(wc -c < "$OUT_DIR/index.html") bytes)"
