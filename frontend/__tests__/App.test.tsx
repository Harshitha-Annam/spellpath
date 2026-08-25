/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(() => Promise.resolve()),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

import App from '../App';

const mockPuzzle = {
  id: 'puzzle_easy_test',
  difficulty: 'easy',
  grid_size: 5,
  word: 'CAT',
  start_cell: [0, 0],
  end_cell: [0, 2],
  milestones: [
    { index: 0, character: 'C', cell: [0, 0] },
    { index: 1, character: 'A', cell: [0, 1] },
    { index: 2, character: 'T', cell: [0, 2] },
  ],
  walls: [],
};

beforeEach(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockPuzzle),
    }),
  ) as jest.Mock;
});

test('renders correctly', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});
