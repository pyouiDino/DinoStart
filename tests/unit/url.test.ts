import { describe, expect, it } from 'vitest';
import { buildSearchUrl, validateSearchTemplate, validateUrl } from '../../src/core/url';

describe('validateUrl', () => {
  it.each([
    ['https://exemple.fr', 'https://exemple.fr/'],
    ['http://exemple.fr/chemin?a=1#x', 'http://exemple.fr/chemin?a=1#x'],
    ['exemple.fr', 'https://exemple.fr/'],
    ['  github.com/dino  ', 'https://github.com/dino'],
    ['localhost:3000', 'https://localhost:3000/'],
    ['192.168.1.10:8080/admin', 'https://192.168.1.10:8080/admin'],
  ])('accepte et normalise %s', (input, expected) => {
    const r = validateUrl(input);
    expect(r.ok && r.value).toBe(expected);
  });

  it.each([
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)',
    'file:///C:/Windows', 'blob:https://x/uuid', 'chrome://settings', 'chrome-extension://abc/page.html', 'about:blank',
    'ftp://exemple.fr', 'mailto:a@b.fr', 'tel:+33123', 'https://user:pass@exemple.fr', 'https://exe mple.fr', 'java\nscript:alert(1)', '', '   ',
  ])('refuse %j', (input) => {
    expect(validateUrl(input).ok).toBe(false);
  });

  it('refuse les adresses trop longues', () => {
    expect(validateUrl(`https://exemple.fr/${'a'.repeat(2100)}`).ok).toBe(false);
  });
});

describe('moteur de recherche Web', () => {
  it('exige https et {query}', () => {
    expect(validateSearchTemplate('https://exemple.fr/?q={query}').ok).toBe(true);
    expect(validateSearchTemplate('http://exemple.fr/?q={query}').ok).toBe(false);
    expect(validateSearchTemplate('https://exemple.fr/?q=').ok).toBe(false);
    expect(validateSearchTemplate('javascript:alert({query})').ok).toBe(false);
    expect(validateSearchTemplate('https://a.fr/{query}/{query}').ok).toBe(false);
  });
  it('encode la requête', () => {
    const r = buildSearchUrl('https://exemple.fr/?q={query}', 'café & thé');
    expect(r.ok && r.value).toBe('https://exemple.fr/?q=caf%C3%A9%20%26%20th%C3%A9');
    expect(buildSearchUrl('https://exemple.fr/?q={query}', '  ').ok).toBe(false);
  });
});
