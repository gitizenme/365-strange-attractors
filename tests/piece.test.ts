import { describe, it, expect } from 'vitest';
import { neighborDay, captionFor, familyLabel } from '../src/piece';

describe('neighborDay', () => {
  it('increments, decrements, and wraps', () => {
    expect(neighborDay(1, 1)).toBe(2);
    expect(neighborDay(365, 1)).toBe(1);
    expect(neighborDay(1, -1)).toBe(365);
    expect(neighborDay(200, -1)).toBe(199);
  });
});

describe('captionFor', () => {
  it('formats day, title, and 2010 date', () => {
    expect(captionFor({ day: 42, title: 'Spirality' })).toBe('042/365 · Spirality · February 11, 2010');
    expect(captionFor({ day: 365, title: 'Icosapods' })).toBe('365/365 · Icosapods · December 31, 2010');
  });
});

describe('familyLabel', () => {
  it('prettifies known attractor families', () => {
    expect(familyLabel('lorenz')).toBe('Lorenz');
    expect(familyLabel('lorenz_84')).toBe('Lorenz-84');
    expect(familyLabel('chaotic_flow')).toBe('Chaotic flow');
    expect(familyLabel('polynomial_sprott')).toBe('Polynomial (Sprott)');
  });
  it('returns null for static-only, unknown, and missing systems', () => {
    expect(familyLabel('static-only')).toBeNull();
    expect(familyLabel('mystery_family')).toBeNull();
    expect(familyLabel(undefined)).toBeNull();
  });
});
