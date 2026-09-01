import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 8080);
const secret = process.env.DOCUMENT_SCANNER_SECRET || '';
const maxBytes = 25 * 1024 * 1024;

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(header = '') {
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return Boolean(secret) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function scan(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('clamscan', ['--no-summary', '--infected', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ status: 'clean', engine: 'clamav' });
      if (code === 1) {
        const signature = output.match(/:\s+(.+)\s+FOUND/)?.[1] ?? 'malware';
        return resolve({ status: 'infected', engine: 'clamav', signature });
      }
      reject(new Error(`clamscan exited ${code}`));
    });
  });
}

function detectMime(path) {
  return new Promise((resolve, reject) => {
    const child = spawn('file', ['--brief', '--mime-type', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`file exited ${code}`)));
  });
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true, engine: 'clamav' });
  if (request.method !== 'POST' || request.url !== '/scan') return json(response, 404, { error: 'NOT_FOUND' });
  if (!authorized(request.headers.authorization)) return json(response, 401, { error: 'UNAUTHORIZED' });
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > maxBytes) return json(response, 413, { error: 'FILE_TOO_LARGE' });

  const directory = await mkdtemp(join(tmpdir(), 'healen-scan-'));
  const path = join(directory, 'document');
  let received = 0;
  try {
    await new Promise((resolve, reject) => {
      const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
      request.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes) request.destroy(new Error('FILE_TOO_LARGE'));
      });
      request.on('error', reject);
      output.on('error', reject);
      output.on('finish', resolve);
      request.pipe(output);
    });
    if (received < 1) return json(response, 400, { error: 'EMPTY_FILE' });
    const [result, detectedMime] = await Promise.all([scan(path), detectMime(path)]);
    return json(response, 200, { ...result, detectedMime });
  } catch (error) {
    return json(response, error instanceof Error && error.message === 'FILE_TOO_LARGE' ? 413 : 500, { error: 'SCAN_FAILED' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}).listen(port, '0.0.0.0');
