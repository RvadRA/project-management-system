import { describe, expect, it } from 'vitest';
import { assistantDrawerClass } from './assistantLayout';

describe('assistantDrawerClass', () => {
  it('uses a wide drawer on desktop', () => {
    expect(assistantDrawerClass(false)).toContain('md:w-[90vw]');
    expect(assistantDrawerClass(false)).toContain('w-full');
    expect(assistantDrawerClass(false)).toContain('md:max-w-[98vw]');
    expect(assistantDrawerClass(false)).toContain('h-[100dvh]');
    expect(assistantDrawerClass(false)).toContain('md:rounded-l-2xl');
  });

  it('expands the drawer without horizontal overflow', () => {
    const expanded = assistantDrawerClass(true);
    expect(expanded).toContain('md:w-screen');
    expect(expanded).toContain('md:max-w-none');
    expect(expanded).toContain('md:rounded-none');
    expect(expanded).not.toContain('max-w-[480px]');
  });
});
