'use strict';
// Repeatable check for the Swagger/OpenAPI documentation (quick 260928-s9u).
// Usage: node verify-swagger.cjs <tracer|full>
// Boots dist/main on VERIFY_PORT (default 3100), fetches /api/docs and
// /api/docs-json, asserts the document, and always kills the child process.
const { spawn } = require('node:child_process');
const path = require('node:path');

const level = process.argv[2];
if (level !== 'tracer' && level !== 'full') {
  console.error('Usage: node verify-swagger.cjs <tracer|full>');
  process.exit(2);
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.VERIFY_PORT || '3100';
const base = `http://localhost:${port}`;
const failures = [];
const fail = (msg) => failures.push(msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRIMITIVES = new Set(['string', 'number', 'integer', 'boolean']);
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function checkProperties(schemaName, schema) {
  const props = schema.properties || {};
  for (const [name, prop] of Object.entries(props)) {
    const where = `schema ${schemaName}.${name}`;
    const documented = [
      'description',
      'example',
      'enum',
      '$ref',
      'allOf',
      'oneOf',
      'items',
    ].some((k) => prop[k] !== undefined);
    if (!documented) {
      fail(`${where}: no description/example/enum/$ref/allOf/oneOf/items`);
      continue;
    }
    const isPrimitive = PRIMITIVES.has(prop.type);
    const hasShape =
      prop.enum !== undefined ||
      prop.$ref !== undefined ||
      prop.allOf !== undefined;
    if (isPrimitive && !hasShape && prop.example === undefined) {
      fail(`${where}: primitive property without example`);
    }
  }
}

function checkOperation(key, op, protectedOp) {
  if (!op.summary || !String(op.summary).trim()) fail(`${key}: empty summary`);
  if (!Array.isArray(op.tags) || op.tags.length === 0) fail(`${key}: no tags`);
  const responses = op.responses || {};
  const okCodes = Object.keys(responses).filter((c) => /^2\d\d$/.test(c));
  if (okCodes.length === 0) fail(`${key}: no 2xx response`);
  const enveloped = okCodes.some((c) =>
    JSON.stringify(responses[c]).includes('#/components/schemas/ResponseDto'),
  );
  if (!enveloped) fail(`${key}: 2xx response does not reference ResponseDto`);
  const hasBearer =
    Array.isArray(op.security) && op.security.some((s) => 'bearer' in s);
  if (protectedOp) {
    if (!hasBearer) fail(`${key}: protected operation lacks bearer security`);
    const r401 = responses['401'];
    if (!r401 || !JSON.stringify(r401).includes('ErrorResponseDto')) {
      fail(`${key}: protected operation lacks 401 ErrorResponseDto response`);
    }
  } else if (hasBearer) {
    fail(`${key}: public operation unexpectedly declares bearer security`);
  }
}

const FULL_OPERATIONS = [
  'POST /auth/register',
  'POST /auth/login',
  'GET /auth/me',
  'POST /auth/refresh',
  'POST /auth/logout',
  ...['accounts', 'categories', 'transactions'].flatMap((r) => [
    `POST /${r}`,
    `GET /${r}`,
    `GET /${r}/{id}`,
    `PATCH /${r}/{id}`,
    `DELETE /${r}/{id}`,
  ]),
  'POST /transfers',
  'DELETE /transfers/{id}',
  'POST /budgets',
  'GET /budgets',
  'GET /budgets/{id}',
  'PATCH /budgets/{id}',
  'DELETE /budgets/{id}',
  'GET /reports/category-summary',
  'GET /reports/net-balance',
  'GET /reports/month-comparison',
  'GET /health',
];
const PUBLIC_OPERATIONS = new Set([
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'GET /health',
]);
const FULL_TAGS = [
  'Auth',
  'Accounts',
  'Categories',
  'Transactions',
  'Transfers',
  'Budgets',
  'Reports',
  'Health',
];

function listOperations(doc) {
  const ops = {};
  for (const [p, item] of Object.entries(doc.paths || {})) {
    for (const m of HTTP_METHODS) {
      if (item[m]) ops[`${m.toUpperCase()} ${p}`] = item[m];
    }
  }
  return ops;
}

function assertBase(doc, schemas) {
  if (!String(doc.openapi).startsWith('3.')) fail(`openapi is ${doc.openapi}`);
  if (doc.info?.title !== 'Financial Control API') {
    fail(`info.title is ${JSON.stringify(doc.info?.title)}`);
  }
  const bearer = doc.components?.securitySchemes?.bearer;
  if (
    !bearer ||
    bearer.type !== 'http' ||
    bearer.scheme !== 'bearer' ||
    bearer.bearerFormat !== 'JWT'
  ) {
    fail(`securitySchemes.bearer wrong: ${JSON.stringify(bearer)}`);
  }
  for (const name of ['ResponseDto', 'ErrorResponseDto']) {
    if (!schemas[name]) fail(`components.schemas lacks ${name}`);
  }
}

function assertTracer(doc, schemas) {
  const ops = listOperations(doc);
  const expected = [
    'GET /accounts',
    'POST /accounts',
    'GET /accounts/{id}',
    'PATCH /accounts/{id}',
    'DELETE /accounts/{id}',
  ];
  for (const key of expected) {
    const op = ops[key];
    if (!op) {
      fail(`missing operation ${key}`);
      continue;
    }
    if (!op.tags?.includes('Accounts')) fail(`${key}: missing tag Accounts`);
    checkOperation(key, op, true);
  }
  for (const name of [
    'CreateAccountDto',
    'UpdateAccountDto',
    'AccountResponseDto',
  ]) {
    if (!schemas[name]) fail(`components.schemas lacks ${name}`);
    else checkProperties(name, schemas[name]);
  }
  const accountType = schemas.AccountType;
  const want = ['corrente', 'poupanca', 'carteira', 'cartao_credito'];
  if (!accountType || JSON.stringify(accountType.enum) !== JSON.stringify(want)) {
    fail(`AccountType.enum is ${JSON.stringify(accountType?.enum)}`);
  }
}

function assertFull(doc, schemas) {
  const ops = listOperations(doc);
  const actual = Object.keys(ops).sort();
  const expected = [...FULL_OPERATIONS].sort();
  for (const k of expected) if (!actual.includes(k)) fail(`missing operation ${k}`);
  for (const k of actual) if (!expected.includes(k)) fail(`unexpected operation ${k}`);
  if (actual.length !== 31) fail(`operation count is ${actual.length}, want 31`);

  const tags = new Set(Object.values(ops).flatMap((o) => o.tags || []));
  const wantTags = [...FULL_TAGS].sort().join(',');
  if ([...tags].sort().join(',') !== wantTags) {
    fail(`tags are ${[...tags].sort().join(',')}, want ${wantTags}`);
  }

  for (const [key, op] of Object.entries(ops)) {
    checkOperation(key, op, !PUBLIC_OPERATIONS.has(key));
  }
  for (const [name, schema] of Object.entries(schemas)) {
    checkProperties(name, schema);
  }
  for (const name of ['AccountType', 'CategoryType', 'TransactionType']) {
    if (!schemas[name]) fail(`components.schemas lacks ${name}`);
  }

  const paramsOf = (key) => ops[key]?.parameters || [];
  const requireQuery = (key, names) => {
    for (const n of names) {
      const p = paramsOf(key).find((x) => x.in === 'query' && x.name === n);
      if (!p) fail(`${key}: missing query parameter ${n}`);
      else {
        if (p.required !== true) fail(`${key}: query ${n} not required`);
        const example = p.example ?? p.schema?.example;
        if (example === undefined) fail(`${key}: query ${n} lacks example`);
      }
    }
  };
  requireQuery('GET /reports/category-summary', ['from', 'to']);
  requireQuery('GET /reports/month-comparison', ['month']);
}

async function waitForDocs(child, getLog) {
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  for (let i = 0; i < 90; i++) {
    if (exited) {
      throw new Error(`app exited early. Log tail:\n${getLog().slice(-3000)}`);
    }
    try {
      const res = await fetch(`${base}/api/docs-json`);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${base}/api/docs-json. Log tail:\n${getLog().slice(-3000)}`);
}

async function main() {
  let log = '';
  const child = spawn(process.execPath, ['dist/main'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  try {
    const jsonRes = await waitForDocs(child, () => log);
    const doc = await jsonRes.json();

    const ui = await fetch(`${base}/api/docs`);
    if (ui.status !== 200) fail(`GET /api/docs status ${ui.status}`);
    if (!(ui.headers.get('content-type') || '').includes('text/html')) {
      fail(`GET /api/docs content-type ${ui.headers.get('content-type')}`);
    }
    const init = await fetch(`${base}/api/docs/swagger-ui-init.js`);
    if (init.status !== 200) fail(`swagger-ui-init.js status ${init.status}`);

    const schemas = doc.components?.schemas || {};
    assertBase(doc, schemas);
    assertTracer(doc, schemas);
    if (level === 'full') assertFull(doc, schemas);
  } catch (err) {
    fail(String(err && err.message ? err.message : err));
  } finally {
    child.kill();
  }

  if (failures.length > 0) {
    console.error(`SWAGGER-VERIFY FAILED (${level}):`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log(`SWAGGER-VERIFY OK (${level})`);
  process.exit(0);
}

main();
