import { expect, it } from 'vitest';
import { chatURLs } from './LiveChat';
it('uses the current video and exact embedding hostname without path or port', () => {
  const urls = chatURLs('abcdefghijk', 'example.github.io')!;
  expect(new URL(urls.embed).searchParams.get('embed_domain')).toBe('example.github.io');
  expect(new URL(urls.popup).searchParams.get('v')).toBe('abcdefghijk');
  expect(chatURLs('javascript:evil', 'example.com')).toBeNull();
  expect(chatURLs('abcdefghijk', 'example.com/path')).toBeNull();
});
