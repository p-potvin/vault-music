#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const testSuites = [
    { name: 'Audio Streaming & Range Requests', script: 'tests/streaming_test.js' },
    { name: 'Swagger & OpenAPI Documentation', script: 'tests/swagger_docs_test.js' },
    { name: 'Metadata & MusicBrainz Engine', script: 'tests/metadata_test.js' }
];

console.log('===============================================================');
console.log('       VAULT MUSIC - MASTER TEST RUNNER SUITE                  ');
console.log('===============================================================\n');

const startTime = Date.now();
let passed = 0;

for (let i = 0; i < testSuites.length; i++) {
    const suite = testSuites[i];
    console.log(`[${i + 1}/${testSuites.length}] Running: ${suite.name} (${suite.script})...`);
    try {
        const out = execFileSync('node', [path.resolve(__dirname, '..', suite.script)], {
            cwd: path.resolve(__dirname, '..'),
            encoding: 'utf8',
            timeout: 60000
        });
        console.log(out.trim());
        console.log(`✓ [PASS] ${suite.name}\n`);
        passed++;
    } catch (err) {
        console.error(`\n❌ [FAIL] ${suite.name}`);
        if (err.stdout) console.error(err.stdout);
        if (err.stderr) console.error(err.stderr);
        process.exit(1);
    }
}

const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
console.log('===============================================================');
console.log(` ALL TEST SUITES PASSED! (${passed}/${testSuites.length} in ${elapsedSec}s)`);
console.log('===============================================================');
