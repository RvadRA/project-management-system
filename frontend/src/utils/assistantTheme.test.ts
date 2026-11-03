import { describe, expect, it } from 'vitest';
// The app tsconfig exposes browser types only; Vitest executes this fixture in Node.
// @ts-expect-error Node built-in types are intentionally excluded from the browser app.
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

describe('assistant theme styles', () => {
  it('scopes higher-contrast status and placeholder colors to the app light theme', () => {
    expect(stylesheet).toContain('.theme-light [role="dialog"][aria-label="ИИ-ассистент"] input::placeholder');
    expect(stylesheet).toContain('[class~="text-amber-200"]');
    expect(stylesheet).toContain('[class~="text-red-200"]');
    expect(stylesheet).toContain('[class~="text-violet-200"]');
  });

  it('preserves the existing dark palette when the light theme class is absent', () => {
    expect(stylesheet).toContain(':root {');
    expect(stylesheet).toContain('--slate-950: #020617;');
    expect(stylesheet).toContain('.theme-light {');
  });
});
