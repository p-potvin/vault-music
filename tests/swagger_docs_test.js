const assert = require('assert').strict;
const http = require('http');
const { app } = require('../src/server');

console.log('======================================================================');
console.log(' VAULT MUSIC: SWAGGER & OPENAPI DOCUMENTATION TEST SUITE              ');
console.log('======================================================================\n');

async function testSwagger() {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 1. Test /openapi.json
        console.log('[Test 1] Testing /openapi.json specification...');
        const jsonRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/openapi.json`, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
            });
        });

        assert.equal(jsonRes.status, 200);
        assert.equal(jsonRes.data.openapi, '3.0.3');
        assert.equal(jsonRes.data.info.title, 'Vault Music API');
        assert.ok(jsonRes.data.paths['/api/v1/stream/{trackId}'], 'Must document stream endpoint');
        assert.ok(jsonRes.data.paths['/api/v1/tracks'], 'Must document tracks endpoint');
        assert.ok(jsonRes.data.paths['/api/v1/metadata/populate'], 'Must document metadata populate endpoint');
        assert.ok(jsonRes.data.paths['/api/v1/downloads/search'], 'Must document downloads search endpoint');
        console.log('✓ [PASS] OpenAPI 3.0.3 specification validated.\n');

        // 2. Test /docs UI redirect/HTML
        console.log('[Test 2] Testing Swagger UI endpoint at /docs...');
        const docsRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/docs/`, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, html: data }));
            });
        });

        assert.equal(docsRes.status, 200);
        assert.ok(docsRes.html.includes('swagger-ui'), 'Must render Swagger UI HTML');
        console.log('✓ [PASS] Swagger UI endpoint verified.\n');

        // 3. Test /health endpoint
        console.log('[Test 3] Testing /health status endpoint...');
        const healthRes = await new Promise((resolve) => {
            http.get(`${baseUrl}/health`, (res) => {
                let data = '';
                res.on('data', c => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
            });
        });

        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.data.status, 'healthy');
        assert.equal(healthRes.data.service, 'vault-music');
        console.log('✓ [PASS] /health endpoint validated.\n');

        console.log('======================================================================');
        console.log(' ALL SWAGGER & API DOCS TESTS PASSED!                                 ');
        console.log('======================================================================');
    } finally {
        server.close();
    }
}

testSwagger().catch(err => {
    console.error('Swagger test failed:', err);
    process.exit(1);
});
