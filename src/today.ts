import type { Artwork } from './data';
import { dayToDate } from './data';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// 2010 was not a leap year, so a visitor's Feb 29 maps to Feb 28's piece.
export function dateToDay2010(month: number, date: number): number {
  const d = month === 2 && date === 29 ? 28 : date;
  let n = 0;
  for (let m = 0; m < month - 1; m++) n += MONTH_DAYS[m];
  return n + d;
}

// The visitor's LOCAL date — it's their "today", not UTC's.
export function resolveToday(now: Date, artworks: Artwork[]): Artwork {
  const day = dateToDay2010(now.getMonth() + 1, now.getDate());
  return artworks.find(a => a.day === day)!;
}

// Constellation sprites are 1.6 world units tall (uSize at aScale 1). Pick the camera height (z)
// that makes the settled sprite fill `fraction` of the viewport's height, centered on it.
export function settleCamera(target: { x: number; y: number }, fovDeg: number,
                             spriteWorldSize = 1.6, fraction = 0.15): { x: number; y: number; z: number } {
  const visibleHeight = spriteWorldSize / fraction;
  return { x: target.x, y: target.y, z: visibleHeight / (2 * Math.tan((fovDeg * Math.PI) / 360)) };
}

export function todayCaption(a: { day: number; title: string }): { label: string; title: string } {
  const { month, date } = dayToDate(a.day);
  return { label: `Day ${String(a.day).padStart(3, '0')} · ${MONTHS[month - 1]} ${date}`, title: a.title };
}
