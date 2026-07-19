export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function parseTitlesCsv(csv) {
  const map = new Map();
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^(\d{3})\/365\s+([^,]+),/);
    if (!m) continue;
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 365 || map.has(day)) continue;
    map.set(day, m[2].trim());
  }
  return map;
}

export function scanGenerated(fileNames) {
  const map = new Map();
  for (const name of fileNames) {
    const m = name.match(/^(\d{3})_(.+)\.(jpe?g|png)$/i);
    if (!m) continue;
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 365 || map.has(day)) continue;
    map.set(day, name);
  }
  return map;
}

export function buildDays(csv, fileNames, maxDay = 365) {
  const titles = parseTitlesCsv(csv);
  const images = scanGenerated(fileNames);
  const days = [];
  for (let day = 1; day <= maxDay; day++) {
    const sourceImage = images.get(day);
    if (!sourceImage) throw new Error(`missing source image for day ${day}`);
    const fallback = sourceImage.replace(/^\d{3}_/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    const title = titles.get(day) ?? fallback;
    const num = String(day).padStart(3, '0');
    days.push({ day, title, slug: `${num}-${slugify(title)}`, sourceImage });
  }
  return days;
}
