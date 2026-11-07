import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../languageDetect';

describe('detectLanguage', () => {
    it('detects a shell one-liner as bash', () => {
        expect(detectLanguage('export abc=aaa; echo $abc')).toBe('bash');
    });

    it('detects scripts through their shebang', () => {
        expect(detectLanguage('#!/bin/bash\nset -euo pipefail\necho "$HOME"')).toBe('bash');
        expect(detectLanguage('#!/usr/bin/env python3\nimport sys\nprint(sys.argv)')).toBe('python');
        expect(detectLanguage('#!/usr/bin/env node\nconst fs = require("fs");')).toBe('javascript');
        // The shebang wins even when the body suggests another language.
        expect(detectLanguage('#!/usr/bin/env python3\nconst x = 1;')).toBe('python');
    });

    it('detects valid JSON before the scoring rules run', () => {
        expect(detectLanguage('{"name": "test", "count": 42}')).toBe('json');
        expect(detectLanguage('[10, 20, 30, 40]')).toBe('json');
    });

    it('prefers typescript over javascript when both score', () => {
        expect(detectLanguage('interface User { name: string; age: number }')).toBe('typescript');
        expect(detectLanguage('const x: number = 1;\nconst y: boolean = true;')).toBe('typescript');
    });

    it('prefers cpp over c when both score', () => {
        expect(detectLanguage('#include <iostream>\nint main() { std::cout << "hi"; }')).toBe('cpp');
        expect(detectLanguage('#include <stdio.h>\nint main() { printf("hi"); return 0; }')).toBe('c');
    });

    it('detects the common languages by their signatures', () => {
        expect(detectLanguage('package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}')).toBe('go');
        expect(detectLanguage('fn main() {\n    println!("hello");\n}')).toBe('rust');
        expect(detectLanguage('SELECT id, name FROM users WHERE id = 1;')).toBe('sql');
        expect(detectLanguage('name: test\nversion: "1.0"\nitems:\n  - a\n  - b')).toBe('yaml');
        expect(detectLanguage('<div class="container">\n  <p>Hello</p>\n</div>')).toBe('html');
        expect(detectLanguage('<?xml version="1.0" encoding="UTF-8"?>\n<config/>')).toBe('xml');
        expect(detectLanguage('.container {\n  color: #fff;\n  padding: 10px;\n}')).toBe('css');
        expect(detectLanguage('<?php\nfunction greet($name) {\n  return "Hi $name";\n}')).toBe('php');
        expect(detectLanguage('require \'sinatra\'\n\nget \'/\' do\n  "hello"\nend')).toBe('ruby');
        expect(detectLanguage('my $name = "world";\nuse strict;\nprint "$name\\n";')).toBe('perl');
        expect(detectLanguage('Get-ChildItem -Path .\nWrite-Host "done"')).toBe('powershell');
        expect(detectLanguage('FROM node:18-alpine\nRUN npm install\nCMD ["node", "app.js"]')).toBe('dockerfile');
        expect(detectLanguage('build:\n\tgcc -o app main.c\n\nclean:\n\trm -f *.o')).toBe('makefile');
        expect(detectLanguage('--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,4 @@\n-old line\n+new line')).toBe('diff');
    });

    it('returns null for content without an unmistakable signature', () => {
        // Shared syntax alone must not elect a language: these fragments are
        // valid in several of the scored languages.
        expect(detectLanguage('function foo(a) { return a; }')).toBeNull();
        expect(detectLanguage('const x = 12345')).toBeNull();
        // `${` is split across literals to keep the template-placeholder shape
        // out of the source, while the runtime string still carries it.
        expect(detectLanguage('const msg = ` + `hello ${' + 'name}`;')).toBeNull();
        expect(detectLanguage('[config]\nkey = value')).toBeNull();
        expect(detectLanguage('hello world this is prose')).toBeNull();
    });

    it('returns null for snippets below the minimum length', () => {
        expect(detectLanguage('ls -la')).toBeNull();
        expect(detectLanguage('')).toBeNull();
    });

    it('returns null when no language reaches the confidence threshold', () => {
        // Two statements of shared syntax score 2 (one boolean match) — below
        // the threshold, so the block stays untagged.
        expect(detectLanguage('let a = 1;\nlet b = 2;')).toBeNull();
    });
});
