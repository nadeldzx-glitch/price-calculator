import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import calculator from './calculator.mjs';

export function createCalculatorServer({
  dataDirectory = resolve(process.env.DATA_DIRECTORY || 'data'),
  adminPassword = process.env.ADMIN_PASSWORD,
  allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
} = {}) {
  const filename = resolve(dataDirectory, 'shared-template.json');
  const env = {
    ADMIN_PASSWORD: adminPassword,
    BUCKET: {
      async get() {
        try {
          const content = await readFile(filename, 'utf8');
          return { text: async () => content };
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      },
      async put(key, value) {
        await mkdir(dataDirectory, { recursive: true });
        const temporary = resolve(dataDirectory, randomUUID() + '.tmp');
        try {
          await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 });
          await rename(temporary, filename);
        } finally {
          await unlink(temporary).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
    }
  };
  return createServer(async (incoming, outgoing) => {
    try {
      const protocol = incoming.headers['x-forwarded-proto']?.split(',')[0].trim() || 'http';
      const origin = process.env.PUBLIC_ORIGIN || protocol + '://' + incoming.headers.host;
      const requestOrigin = incoming.headers.origin;
      const crossOrigin = requestOrigin && requestOrigin !== origin;
      if (crossOrigin && !allowedOrigins.includes(requestOrigin)) {
        outgoing.writeHead(403);
        outgoing.end('Origin not allowed');
        return;
      }
      const corsHeaders = crossOrigin ? {
        'Access-Control-Allow-Origin': requestOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin'
      } : {};
      if (incoming.method === 'OPTIONS') {
        outgoing.writeHead(204, corsHeaders);
        outgoing.end();
        return;
      }
      const headers = new Headers(incoming.headers);
      if (crossOrigin) headers.delete('Origin');
      const options = { method: incoming.method, headers };
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        options.body = Readable.toWeb(incoming);
        options.duplex = 'half';
      }
      const response = await calculator.fetch(new Request(new URL(incoming.url, origin), options), env);
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...corsHeaders });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      outgoing.end(JSON.stringify({ message: '服务暂时不可用，请重试' }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createCalculatorServer();
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
    console.log('报价计算器服务已启动，端口 ' + server.address().port);
  });
}
