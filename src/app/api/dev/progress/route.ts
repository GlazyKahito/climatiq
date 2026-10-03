import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Development-only build tracker. Disabled in production builds.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return Response.json({ error: 'Not available' }, { status: 404 });
  }
  const raw = await readFile(join(process.cwd(), 'progress.json'), 'utf8');
  return new Response(raw, {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
