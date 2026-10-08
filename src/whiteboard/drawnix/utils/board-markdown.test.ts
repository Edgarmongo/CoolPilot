import { describe, expect, it } from 'vitest';
import type { PlaitElement } from '@plait/core';
import {
  boardToMarkdown,
  extractText,
  type BoardMarkdownLabels,
} from './board-markdown';

const labels: BoardMarkdownLabels = {
  emptyTopic: '(untitled)',
  standaloneSection: 'Board elements',
  textElement: 'Text',
  shapeElement: 'Shape',
  imageElement: 'Image',
};

const paragraph = (text: string) => ({
  type: 'paragraph',
  children: [{ text }],
});

type MindNode = {
  id: string;
  type: string;
  data: { topic: ReturnType<typeof paragraph> };
  children: MindNode[];
  points: number[][];
};

type MindNodeOptions = {
  topic?: string;
  children?: MindNode[];
  type?: string;
};

const mindElement = ({
  topic,
  children = [],
  type = 'mind_child',
}: MindNodeOptions = {}): MindNode => ({
  id: `mind-${type}-${topic ?? 'empty'}-${children.length}`,
  type,
  data: { topic: paragraph(topic ?? '') },
  children,
  points: [[0, 0]],
});

const asElements = (value: unknown[]) => value as unknown as PlaitElement[];

describe('extractText', () => {
  it('flattens slate paragraphs, nested children and raw strings', () => {
    expect(extractText(paragraph('hello'))).toBe('hello');
    expect(
      extractText({ type: 'paragraph', children: [{ text: 'a' }, { text: 'b' }] }),
    ).toBe('ab');
    expect(extractText([{ text: 'x' }, { children: [{ text: 'y' }] }])).toBe('xy');
    expect(extractText('plain')).toBe('plain');
    expect(extractText(undefined)).toBe('');
    expect(extractText(42)).toBe('');
  });
});

describe('boardToMarkdown', () => {
  it('returns an empty string for an empty board', () => {
    expect(boardToMarkdown([], labels)).toBe('');
    expect(boardToMarkdown(undefined, labels)).toBe('');
  });

  it('renders a mind map as a heading outline', () => {
    const board = asElements([
      mindElement({
        topic: 'Root',
        type: 'mind',
        children: [
          mindElement({
            topic: 'Branch A',
            children: [mindElement({ topic: 'Leaf A1' })],
          }),
          mindElement({ topic: 'Branch B' }),
        ],
      }),
    ]);

    expect(boardToMarkdown(board, labels)).toBe(
      ['# Root', '## Branch A', '### Leaf A1', '## Branch B'].join('\n'),
    );
  });

  it('falls back to indented bullets deeper than six levels', () => {
    let node = mindElement({ topic: 'L7' });
    for (let level = 6; level >= 1; level -= 1) {
      node = mindElement({ topic: `L${level}`, children: [node] });
    }
    const board = asElements([{ ...node, type: 'mind' }]);

    const markdown = boardToMarkdown(board, labels).split('\n');

    expect(markdown.slice(0, 6)).toEqual([
      '# L1',
      '## L2',
      '### L3',
      '#### L4',
      '##### L5',
      '###### L6',
    ]);
    expect(markdown[6]).toBe('- L7');
  });

  it('uses the placeholder for topics without text', () => {
    const board = asElements([mindElement({ type: 'mind' })]);
    expect(boardToMarkdown(board, labels)).toBe('# (untitled)');
  });

  it('collects loose text, shapes and images into a standalone section', () => {
    const board = asElements([
      { id: 'text-1', type: 'text', text: paragraph('note text') },
      { id: 'shape-1', type: 'geometry', shape: 'rectangle', text: paragraph('step 1') },
      { id: 'image-1', type: 'image', url: 'https://example.com/a.png' },
      { id: 'image-2', type: 'image', url: '' },
      { id: 'freehand-1', type: 'freehand' },
      { id: 'group-1', type: 'group', children: [] },
    ]);

    expect(boardToMarkdown(board, labels)).toBe(
      [
        '# Board elements',
        '',
        '- Text: note text',
        '- Shape: step 1',
        '- Image: https://example.com/a.png',
      ].join('\n'),
    );
  });

  it('keeps mind maps before the standalone section', () => {
    const board = asElements([
      { id: 'text-1', type: 'text', text: paragraph('loose') },
      mindElement({ topic: 'Only root', type: 'mind' }),
    ]);

    expect(boardToMarkdown(board, labels)).toBe(
      ['# Only root', '', '# Board elements', '', '- Text: loose'].join('\n'),
    );
  });

  it('ignores mind children that are not mind elements and unknown shapes', () => {
    const board = asElements([
      {
        ...mindElement({ topic: 'Root', type: 'mind' }),
        children: [{ id: 'nested-image', type: 'image', url: 'https://example.com/b.png' }],
      },
      null,
    ]);

    expect(boardToMarkdown(board, labels)).toBe('# Root');
  });
});
