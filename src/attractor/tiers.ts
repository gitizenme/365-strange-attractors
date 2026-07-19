export type Tier = 256 | 1024 | 2048;

export function pickTier(opts: { deviceMemoryGB?: number; isMobile: boolean; webgl2: boolean }): Tier | null {
  if (!opts.webgl2) return null;
  if (opts.isMobile) return 256;
  if ((opts.deviceMemoryGB ?? 0) >= 8) return 2048;
  return 1024;
}
