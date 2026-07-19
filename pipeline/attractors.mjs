import { join } from 'node:path';

export const IN_SCOPE_FAMILIES = new Set([
  'lorenz', 'lorenz_84', 'chaotic_flow', 'pickover',
  'polynomial_a', 'polynomial_b', 'polynomial_c', 'polynomial_func', 'polynomial_sprott',
]);

export function parseCsproj(content) {
  const m = content.match(/attractor\s*\{[^}]*?type\s+(\S+)[^}]*?iterations\s+(\d+)[^}]*?parameters\s*<([^>]*)>/);
  if (!m) return null;
  const params = m[3].split(',').map(s => parseFloat(s.trim())).filter(n => !Number.isNaN(n));
  if (params.length === 0) return null;
  return { type: m[1], iterations: parseInt(m[2], 10), params };
}

export function pickAttractorFile(day, csprojFiles) {
  if (csprojFiles.length === 0) return null;
  const num = String(day).padStart(3, '0');
  const prefixed = csprojFiles.find(f => f.startsWith(`${num}_`));
  return prefixed ?? csprojFiles[0];
}

export function buildAttractors(days, archiveRoot, fs) {
  return days.map(({ day, slug }) => {
    const dir = join(archiveRoot, 'project', String(day).padStart(3, '0'));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csproj'));
    const chosen = pickAttractorFile(day, files);
    if (!chosen) return { day, slug, system: 'static-only' };
    const parsed = parseCsproj(fs.readFileSync(join(dir, chosen), 'utf8'));
    if (!parsed || !IN_SCOPE_FAMILIES.has(parsed.type)) return { day, slug, system: 'static-only' };
    return { day, slug, system: parsed.type, iterations: parsed.iterations, params: parsed.params };
  });
}
