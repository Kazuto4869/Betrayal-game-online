import { describe, expect, it } from 'vitest';
import { resolveProjectPath, resolveProjectRoot } from './config.js';

describe('project-root resolution', () => {
  it('resolves the repository root when run from the server workspace', () => {
    expect(resolveProjectRoot('/repo/packages/server')).toBe('/repo');
  });

  it('keeps an ordinary root working directory unchanged', () => {
    expect(resolveProjectRoot('/repo')).toBe('/repo');
  });

  it('resolves relative configured paths from the project root', () => {
    expect(resolveProjectPath('/repo', 'content')).toBe('/repo/content');
    expect(resolveProjectPath('/repo', '/tmp/content')).toBe('/tmp/content');
  });
});
