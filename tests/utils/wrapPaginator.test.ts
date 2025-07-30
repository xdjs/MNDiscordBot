import { buildWrapPayload } from '../../src/utils/wrapPaginator.js';

describe('buildWrapPayload', () => {
  it('returns embed payload without buttons when only one page', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const payload = buildWrapPayload(lines, 0, 'My Title');
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toBeUndefined();
    expect(payload.embeds[0]).toMatchObject({
      title: 'My Title',
      description: lines.join('\n'),
    });
    expect(payload.embeds[0].footer.text).toBe('Page 1 / 1');
  });

  it('paginates correctly and disables prev on first page', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
    const payload = buildWrapPayload(lines, 0, 'Paginated');
    expect(payload.embeds[0].footer.text).toBe('Page 1 / 2');
    expect(payload.components).toBeDefined();
    const [row] = payload.components!;
    expect(row.components[0].disabled).toBe(true); // prev button disabled
    expect(row.components[1].disabled).toBe(false); // next enabled
  });

  it('paginates correctly and disables next on last page', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
    const payload = buildWrapPayload(lines, 1, 'Paginated');
    expect(payload.embeds[0].footer.text).toBe('Page 2 / 2');
    const [row] = payload.components!;
    expect(row.components[0].disabled).toBe(false);
    expect(row.components[1].disabled).toBe(true);
  });

  it('bounds page argument to valid range', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `Line ${i + 1}`);
    const payload = buildWrapPayload(lines, 100, 'Overflow');
    expect(payload.embeds[0].footer.text).toBe('Page 1 / 1');
  });
});
