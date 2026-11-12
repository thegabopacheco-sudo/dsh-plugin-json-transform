// Test end-to-end de json-transform.
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'json-transform'), { recursive: true });
writeFileSync(path.join(home, 'json-transform', 'config.json'), JSON.stringify({ allowedPaths: [tmpDir] }), 'utf8');
const data = [
  { nombre: 'Ana', edad: 30, ciudad: { nombre: 'Madrid' } },
  { nombre: 'Luis', edad: 25, ciudad: { nombre: 'Bogota' } },
  { nombre: 'Ana', edad: 30, ciudad: { nombre: 'Madrid' } },
];
const jsonFile = path.join(tmpDir, 'data.json');
writeFileSync(jsonFile, JSON.stringify(data), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.JSONTRANSFORM_SERVER ? path.resolve(process.env.JSONTRANSFORM_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'jsontransform-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
const run = async (client, args) => JSON.parse(textOf(await client.callTool({ name: 'transform', arguments: { input: JSON.stringify(data), ...args } })));

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).map ? 'x' : '');
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const picked = await run(client, { pick: ['nombre'] });
console.log('pick:', JSON.stringify(picked));
console.log('pick funciona:', picked.length === 3 && picked[0].nombre === 'Ana' && !('edad' in picked[0]));
const omitted = await run(client, { omit: ['edad', 'ciudad'] });
console.log('omit funciona:', !('edad' in omitted[0]) && !('ciudad' in omitted[0]));
const renamed = await run(client, { rename: { nombre: 'name' } });
console.log('rename funciona:', renamed[0].name === 'Ana' && !('nombre' in renamed[0]));
const flat = await run(client, { flatten: true, pick: ['nombre', 'ciudad.nombre'] });
console.log('flatten funciona:', flat[0]['ciudad.nombre'] === 'Madrid');
const sorted = await run(client, { sortBy: { field: 'edad', order: 'desc' }, limit: 2 });
console.log('sort+limit:', sorted.length === 2 && sorted[0].nombre === 'Ana');
const filtered = await run(client, { filterBy: { field: 'edad', equals: 30 } });
console.log('filterBy:', filtered.length === 2);
const got = await run(client, { get: '1.nombre' });
console.log('get ruta:', got === 'Luis');
const fromFile = JSON.parse(textOf(await client.callTool({ name: 'transform', arguments: { path: jsonFile, pick: ['nombre'] } })));
console.log('lee archivo:', fromFile[1].nombre === 'Luis');
const noConfirm = await client.callTool({ name: 'transform', arguments: { input: JSON.stringify(data), output: path.join(tmpDir, 'out.json') } });
console.log('output sin confirm isError:', noConfirm.isError === true);
const saved = await client.callTool({ name: 'transform', arguments: { input: JSON.stringify(data), pick: ['nombre'], output: path.join(tmpDir, 'out.json'), confirm: true } });
const savedText = textOf(saved);
const outFile = savedText.replace('Guardado: ', '').split(' (')[0];
console.log('archivo escrito:', existsSync(outFile) && JSON.parse(readFileSync(outFile, 'utf8'))[0].nombre === 'Ana');
const invalid = await client.callTool({ name: 'transform', arguments: { input: '{ roto' } });
console.log('json inválido isError:', invalid.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_JSONTRANSFORM_MODE: 'read-only' });
const roSave = await roClient.callTool({ name: 'transform', arguments: { input: JSON.stringify(data), output: path.join(tmpDir, 'ro.json'), confirm: true } });
console.log('read-only output isError:', roSave.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
