'use strict';

// Template tệp lời giải. Không phụ thuộc VS Code. Chỗ giữ: ${problem} ${name} ${contest} ${date} ${cursor}.
const defaults = {
  cpp: `// \${contest} · Bài \${problem}: \${name}
#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);
    \${cursor}
    return 0;
}
`,
  c: `// \${contest} · Bài \${problem}: \${name}
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    \${cursor}
    return 0;
}
`,
  py: `# \${contest} · Bài \${problem}: \${name}
import sys
input = sys.stdin.readline


def main():
    \${cursor}pass


main()
`,
  java: `// \${contest} · Bài \${problem}: \${name}
import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        \${cursor}
    }
}
`
};

const dateText = date => {
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
};

// Trả về { text, cursor } trong đó cursor = { line, character } (từ 0) của ${cursor} đầu tiên, đã bỏ khỏi văn bản.
function fill(template, { problem = '', name = '', contest = '', date = new Date() } = {}) {
  const values = { problem, name, contest, date: dateText(date) };
  const filled = String(template).replace(/\$\{(problem|name|contest|date)\}/g, (_, key) => values[key]);
  const marker = '${cursor}';
  const index = filled.indexOf(marker);
  if (index < 0) return { text: filled, cursor: undefined };
  const before = filled.slice(0, index);
  const lastBreak = before.lastIndexOf('\n');
  return {
    text: before + filled.slice(index + marker.length).split(marker).join(''),
    cursor: { line: before.split('\n').length - 1, character: before.length - lastBreak - 1 }
  };
}

module.exports = { dateText, defaults, fill };
