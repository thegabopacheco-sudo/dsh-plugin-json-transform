#!/usr/bin/env node
// dsh-plugin-json-transform — transforma JSON sin eval.
// Tools: status, transform.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'json-transform', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'json-transform');
const READ_ONLY = String(process.env.DSH_JSONTRANSFORM_MODE || '').toLowerCase() === 'read-only';
const MAX_BYTES = 20 * 1024 * 1024;
const log = (m) => process.stderr.write(`[jsontransform] ${m}\n`);

function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { allowedPaths: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { allowedPaths: [] }; }
function allowedRoots() { const configured = loadConfig().allowedPaths; return (Array.isArray(configured) && configured.length ? configured : [process.env.USERPROFILE || process.env.HOME || os.homedir()]).map((item) => path.resolve(item)); }
function isAllowed(target) { const resolved = path.resolve(target); return resolved === CACHE_DIR || resolved.startsWith(CACHE_DIR + path.sep) || allowedRoots().some((root) => resolved === root || resolved.startsWith(root + path.sep)); }

function parsePath(pathText) {
  const tokens = [];
  for (const part of String(pathText).split('.')) {
    const matches = part.match(/([^[\]]+)|\[(\d+)\]/g) || [];
    for (const match of matches) {
      if (match.startsWith('[')) tokens.push(Number(match.slice(1, -1)));
      else tokens.push(match);
    }
  }
  return tokens;
}
function getPath(value, pathText) {
  let current = value;
  for (const token of parsePath(pathText)) {
    if (current === null || current === undefined) return undefined;
    current = current[token];
  }
  return current;
}
function flattenObject(value, prefix = '', out = {}) {
  for (const [key, item] of Object.entries(value || {})) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item && typeof item === 'object' && !Array.isArray(item)) flattenObject(item, full, out);
    else out[full] = item;
  }
  return out;
}
function applyOps(root, ops) {
  let data = ops.get ? getPath(root, ops.get) : root;
  const mapItems = (fn) => Array.isArray(data) ? data.map((item) => (item && typeof item === 'object' ? fn(item) : item)) : (data && typeof data === 'object' ? fn(data) : data);
  if (ops.flatten) data = mapItems((item) => flattenObject(item));
  if (ops.pick?.length) data = mapItems((item) => Object.fromEntries(ops.pick.filter((field) => field in item).map((field) => [field, item[field]])));
  if (ops.omit?.length) data = mapItems((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !ops.omit.includes(key))));
  if (ops.rename && Object.keys(ops.rename).length) data = mapItems((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [ops.rename[key] || key, value])));
  if (Array.isArray(data)) {
    if (ops.filterBy?.field) data = data.filter((item) => item && item[ops.filterBy.field] === ops.filterBy.equals);
    if (ops.sortBy?.field) { const direction = ops.sortBy.order === 'desc' ? -1 : 1; data = [...data].sort((a, b) => { const left = a?.[ops.sortBy.field]; const right = b?.[ops.sortBy.field]; if (left === right) return 0; return (left > right ? 1 : -1) * direction; }); }
    if (ops.limit) data = data.slice(0, ops.limit);
  }
  return data;
}
function loadInput(args) {
  if (args.path) {
    const resolved = path.resolve(args.path);
    if (!existsSync(resolved)) throw new Error(`archivo no existe: ${resolved}`);
    if (!isAllowed(resolved)) throw new Error(`ruta no permitida (revisa allowedPaths): ${resolved}`);
    const text = readFileSync(resolved, 'utf8');
    if (text.length > MAX_BYTES) throw new Error('JSON demasiado grande (máx 20 MB)');
    try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch (error) { throw new Error(`JSON inválido: ${error.message}`); }
  }
  if (typeof args.input === 'string') {
    if (args.input.length > MAX_BYTES) throw new Error('JSON demasiado grande (máx 20 MB)');
    try { return JSON.parse(args.input); } catch (error) { throw new Error(`JSON inválido: ${error.message}`); }
  }
  throw new Error('pasa input (texto JSON) o path (archivo .json)');
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }
function uniquePath(target) { if (!existsSync(target)) return target; const parsed = path.parse(target); for (let index = 1; index < 1000; index++) { const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`); if (!existsSync(candidate)) return candidate; } throw new Error('no se pudo generar nombre único'); }

function buildInstructions() {
  return [
    'JSON Transform: transforma JSON local sin eval ni red.',
    '',
    `Salidas: ${CACHE_DIR}`,
    '',
    'Herramientas: status, transform.',
    '',
    'Reglas:',
    '- Operaciones seguras: get, pick, omit, rename, flatten, filterBy, sortBy, limit.',
    '- Si pasas output, escribir requiere confirm:true; respeta allowedPaths y no sobrescribe.',
    '- Reporta el resultado real; nunca inventes campos.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-json-transform', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool(
    'status',
    { title: 'Estado', description: 'Rutas permitidas y modo.', inputSchema: z.object({}) },
    async () => textResult([`Rutas permitidas: ${allowedRoots().join(', ')}`, `Salida: ${CACHE_DIR}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')),
  );
  server.registerTool(
    'transform',
    {
      title: 'Transformar JSON',
      description: 'Aplica operaciones y devuelve el JSON resultante (o lo guarda con confirm).',
      inputSchema: z.object({
        input: z.string().optional(),
        path: z.string().optional(),
        get: z.string().optional(),
        pick: z.array(z.string()).max(50).optional(),
        omit: z.array(z.string()).max(50).optional(),
        rename: z.record(z.string(), z.string()).optional(),
        flatten: z.boolean().optional(),
        filterBy: z.object({ field: z.string(), equals: z.union([z.string(), z.number(), z.boolean()]) }).optional(),
        sortBy: z.object({ field: z.string(), order: z.enum(['asc', 'desc']).optional() }).optional(),
        limit: z.number().int().min(1).max(100000).optional(),
        output: z.string().optional(),
        confirm: z.boolean().optional(),
      }),
    },
    async (args) => {
      const root = loadInput(args);
      const result = applyOps(root, args);
      const rendered = JSON.stringify(result, null, 2);
      if (!args.output) return textResult(rendered);
      if (READ_ONLY) throw new Error('modo read-only: output deshabilitado');
      if (args.confirm !== true) throw new Error('escribir output requiere confirm:true');
      const target = path.resolve(args.output);
      if (!isAllowed(target)) throw new Error(`ruta de salida no permitida: ${target}`);
      mkdirSync(path.dirname(target), { recursive: true });
      const file = uniquePath(target);
      writeFileSync(file, rendered + '\n', 'utf8');
      return textResult(`Guardado: ${file} (${rendered.length} bytes)`);
    },
  );
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
