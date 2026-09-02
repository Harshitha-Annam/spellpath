import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  GestureResponderEvent,
  LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Line, Circle, G, Rect, Text as SvgText } from 'react-native-svg';
import { PuzzleData, GridPos } from '../types';
import { getWallKey } from '../puzzleGenerator';
import { areMilestonesSequential } from '../scoring';

interface Props {
  puzzle: PuzzleData;
  path: GridPos[];
  onPathChange: (newPath: GridPos[]) => void;
  onDragChange?: (dragging: boolean) => void;
  /** When true (e.g. puzzle solved), ignore further drag drawing. */
  interactionLocked?: boolean;
  /** Wrong-way adjacent drag attempt. */
  onMiss?: () => void;
  /** Drag back onto the previous path cell (undo). */
  onBacktrack?: () => void;
}

function sameCell(a: GridPos, b: GridPos) {
  return a.row === b.row && a.col === b.col;
}

function cellKey(p: GridPos) {
  return `${p.row},${p.col}`;
}

/** Ignore tiny press jitter so a tap never grows the path. */
const DRAG_ACTIVATE_PX = 10;

export const GameBoard: React.FC<Props> = ({
  puzzle,
  path,
  onPathChange,
  onDragChange,
  interactionLocked = false,
  onMiss,
  onBacktrack,
}) => {
  const { gridSize, cells, walls, startCell, milestones } = puzzle;

  const screenWidth = Dimensions.get('window').width;
  const boardSize = Math.min(screenWidth - 32, 420);
  const cellSize = boardSize / gridSize;

  const wallSet = useMemo(() => {
    const set = new Set<string>();
    walls.forEach((w) => {
      set.add(getWallKey(w.row1, w.col1, w.row2, w.col2));
    });
    return set;
  }, [walls]);

  // Local path drives rendering; parent is updated at most once per frame.
  const [localPath, setLocalPath] = useState<GridPos[]>(() => [startCell]);
  const pathRef = useRef<GridPos[]>([startCell]);
  const visitedRef = useRef<Set<string>>(new Set([cellKey(startCell)]));

  const boardOrigin = useRef({ x: 0, y: 0 });
  const pointerDownRef = useRef(false);
  const dragActiveRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastStrokeRef = useRef<{ x: number; y: number } | null>(null);
  const pendingCommitRef = useRef<GridPos[] | null>(null);
  const commitRafRef = useRef<number | null>(null);
  const lockedRef = useRef(interactionLocked);
  lockedRef.current = interactionLocked;
  const puzzleIdRef = useRef<string | null>(null);
  /** Dedupe miss/backtrack while finger stays on the same invalid/prev cell. */
  const lastStatsCellRef = useRef<string | null>(null);
  const onMissRef = useRef(onMiss);
  const onBacktrackRef = useRef(onBacktrack);
  const onDragChangeRef = useRef(onDragChange);
  const scrollLockRef = useRef(false);
  onMissRef.current = onMiss;
  onBacktrackRef.current = onBacktrack;
  onDragChangeRef.current = onDragChange;

  const setParentScrollLock = useCallback((locked: boolean) => {
    if (scrollLockRef.current === locked) {
      return;
    }
    scrollLockRef.current = locked;
    onDragChangeRef.current?.(locked);
  }, []);

  const resetBoardPath = useCallback(
    (next: GridPos[]) => {
      pathRef.current = next;
      visitedRef.current = new Set(next.map(cellKey));
      setLocalPath(next);
    },
    [],
  );

  const cancelPendingCommit = useCallback(() => {
    if (commitRafRef.current != null) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = null;
    }
    pendingCommitRef.current = null;
  }, []);

  // Hard reset when the puzzle changes — never carry path/drag state across boards.
  useEffect(() => {
    if (puzzleIdRef.current === puzzle.id) {
      return;
    }
    puzzleIdRef.current = puzzle.id;
    pointerDownRef.current = false;
    dragActiveRef.current = false;
    pressStartRef.current = null;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;
    cancelPendingCommit();
    resetBoardPath([startCell]);
  }, [puzzle.id, startCell, cancelPendingCommit, resetBoardPath]);

  // Sync from parent when not actively dragging (reset / solution / same puzzle).
  useEffect(() => {
    if (pointerDownRef.current) {
      return;
    }
    pathRef.current = path;
    visitedRef.current = new Set(path.map(cellKey));
    setLocalPath(path);
  }, [path]);

  useEffect(() => {
    return () => {
      cancelPendingCommit();
    };
  }, [cancelPendingCommit]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const target = e.target as unknown as View;
    if (target && typeof (target as View).measureInWindow === 'function') {
      (target as View).measureInWindow((x, y) => {
        boardOrigin.current = { x, y };
      });
    }
  }, []);

  const measureFromEvent = (evt: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = evt.nativeEvent;
    if (typeof locationX === 'number' && typeof locationY === 'number') {
      return { x: locationX, y: locationY };
    }
    return {
      x: pageX - boardOrigin.current.x,
      y: pageY - boardOrigin.current.y,
    };
  };

  const cellAt = (localX: number, localY: number): GridPos | null => {
    const col = Math.floor(localX / cellSize);
    const row = Math.floor(localY / cellSize);
    if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
      return null;
    }
    return { row, col };
  };

  const isBlocked = (a: GridPos, b: GridPos) =>
    wallSet.has(getWallKey(a.row, a.col, b.row, b.col));

  const canEnter = (from: GridPos, to: GridPos) => {
    const orthogonal =
      Math.abs(to.row - from.row) + Math.abs(to.col - from.col) === 1;
    if (!orthogonal) {
      return false;
    }
    if (visitedRef.current.has(cellKey(to))) {
      return false;
    }
    if (isBlocked(from, to)) {
      return false;
    }
    return true;
  };

  const scheduleCommit = (next: GridPos[]) => {
    const commitForPuzzle = puzzleIdRef.current;
    pendingCommitRef.current = next;
    if (commitRafRef.current != null) {
      return;
    }
    commitRafRef.current = requestAnimationFrame(() => {
      commitRafRef.current = null;
      if (puzzleIdRef.current !== commitForPuzzle) {
        pendingCommitRef.current = null;
        return;
      }
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      if (!pending) {
        return;
      }
      setLocalPath(pending);
      onPathChange(pending);
    });
  };

  /** Only enter the cell under the finger — never chase distant cells. */
  const tryEnterCell = (target: GridPos) => {
    if (lockedRef.current) {
      return;
    }

    const current = pathRef.current;
    if (current.length === 0) {
      if (sameCell(target, startCell)) {
        const next = [startCell];
        pathRef.current = next;
        visitedRef.current = new Set([cellKey(startCell)]);
        lastStatsCellRef.current = null;
        scheduleCommit(next);
      }
      return;
    }

    const head = current[current.length - 1];
    if (sameCell(head, target)) {
      lastStatsCellRef.current = null;
      return;
    }

    const targetKey = cellKey(target);

    // Undo one step when dragging back onto the previous cell.
    if (current.length >= 2 && sameCell(current[current.length - 2], target)) {
      if (lastStatsCellRef.current !== `back:${targetKey}`) {
        lastStatsCellRef.current = `back:${targetKey}`;
        onBacktrackRef.current?.();
      }
      const removed = current[current.length - 1];
      const next = current.slice(0, -1);
      pathRef.current = next;
      visitedRef.current.delete(cellKey(removed));
      scheduleCommit(next);
      return;
    }

    if (current.length >= gridSize * gridSize) {
      return;
    }

    const orthogonal =
      Math.abs(target.row - head.row) + Math.abs(target.col - head.col) === 1;

    if (!orthogonal) {
      return;
    }

    if (canEnter(head, target)) {
      lastStatsCellRef.current = null;
      const next = [...current, target];
      pathRef.current = next;
      visitedRef.current.add(cellKey(target));
      scheduleCommit(next);
      return;
    }

    // Adjacent but illegal (wall or revisit) = miss.
    if (lastStatsCellRef.current !== `miss:${targetKey}`) {
      lastStatsCellRef.current = `miss:${targetKey}`;
      onMissRef.current?.();
    }
  };

  /**
   * Sample along the finger stroke so fast swipes still fill adjacent cells
   * the pointer crossed — without a rubber-band stick or sideways elongation.
   */
  const handleStroke = (x: number, y: number) => {
    const prev = lastStrokeRef.current;
    lastStrokeRef.current = { x, y };

    if (!prev) {
      const cell = cellAt(x, y);
      if (cell) {
        tryEnterCell(cell);
      }
      return;
    }

    const dist = Math.hypot(x - prev.x, y - prev.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(cellSize * 0.2, 4)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = prev.x + (x - prev.x) * t;
      const sy = prev.y + (y - prev.y) * t;
      const cell = cellAt(sx, sy);
      if (cell) {
        tryEnterCell(cell);
      }
    }
  };

  const startDrag = (evt: GestureResponderEvent) => {
    if (lockedRef.current) {
      return;
    }
    pointerDownRef.current = true;
    dragActiveRef.current = false;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;
    const { x, y } = measureFromEvent(evt);
    pressStartRef.current = { x, y };
    setParentScrollLock(true);
    // Intentionally do not extend path on press — taps must not create a path.
  };

  const moveDrag = (evt: GestureResponderEvent) => {
    if (lockedRef.current || !pointerDownRef.current) {
      return;
    }

    const { x, y } = measureFromEvent(evt);
    const clamped = {
      x: Math.max(0, Math.min(boardSize, x)),
      y: Math.max(0, Math.min(boardSize, y)),
    };

    if (!dragActiveRef.current) {
      const start = pressStartRef.current;
      if (!start) {
        return;
      }
      const dist = Math.hypot(clamped.x - start.x, clamped.y - start.y);
      if (dist < DRAG_ACTIVATE_PX) {
        return;
      }
      dragActiveRef.current = true;
      lastStrokeRef.current = start;
    }

    handleStroke(clamped.x, clamped.y);
  };

  const endDrag = () => {
    if (!pointerDownRef.current) {
      return;
    }
    pointerDownRef.current = false;
    dragActiveRef.current = false;
    pressStartRef.current = null;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;

    // Flush any pending path commit immediately so parent stays in sync.
    if (commitRafRef.current != null) {
      cancelAnimationFrame(commitRafRef.current);
      commitRafRef.current = null;
    }
    if (pendingCommitRef.current) {
      const pending = pendingCommitRef.current;
      pendingCommitRef.current = null;
      setLocalPath(pending);
      onPathChange(pending);
    }

    setParentScrollLock(false);
  };

  const handleTouchStart = () => {
    if (lockedRef.current) {
      return;
    }
    // Lock parent scroll before the responder grant so upward drags don't
    // trigger ScrollView overscroll (especially from the bottom start cell).
    setParentScrollLock(true);
  };

  const handleTouchEnd = () => {
    setParentScrollLock(false);
  };

  const pathKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const p of localPath) {
      set.add(cellKey(p));
    }
    return set;
  }, [localPath]);

  const pathSvgD = useMemo(() => {
    if (localPath.length < 2) {
      return '';
    }
    const points = localPath.map((p) => ({
      x: (p.col + 0.5) * cellSize,
      y: (p.row + 0.5) * cellSize,
    }));
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }, [localPath, cellSize]);

  const bubbleSize = Math.min(cellSize * 0.65, 46);
  const bubbleRadius = bubbleSize / 2;
  const letterFontSize = Math.min(cellSize * 0.35, 20);
  const tubeWidth = Math.min(cellSize * 0.58, 34);

  const head = localPath.length > 0 ? localPath[localPath.length - 1] : null;

  const pathComplete = localPath.length === gridSize * gridSize;
  const pathWrong =
    pathComplete && !areMilestonesSequential(milestones, localPath);

  // Always-visible milestone markers (drawn in SVG above the path).
  const letterMarkers = useMemo(() => {
    const markers: Array<{
      row: number;
      col: number;
      letter: string;
      isStart: boolean;
    }> = [];
    for (const rowCells of cells) {
      for (const cell of rowCells) {
        if (cell.letter) {
          markers.push({
            row: cell.row,
            col: cell.col,
            letter: cell.letter,
            isStart: !!cell.isStart,
          });
        }
      }
    }
    return markers;
  }, [cells]);

  const gridLines = useMemo(() => {
    const lines: Array<{
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }> = [];
    for (let i = 1; i < gridSize; i++) {
      const offset = i * cellSize;
      lines.push({
        key: `v_${i}`,
        x1: offset,
        y1: 0,
        x2: offset,
        y2: boardSize,
      });
      lines.push({
        key: `h_${i}`,
        x1: 0,
        y1: offset,
        x2: boardSize,
        y2: offset,
      });
    }
    return lines;
  }, [gridSize, cellSize, boardSize]);

  return (
    <View style={styles.boardWrapper}>
      <View
        collapsable={false}
        onLayout={onLayout}
        style={[
          styles.boardContainer,
          { width: boardSize, height: boardSize },
        ]}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponderCapture={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={startDrag}
        onResponderMove={moveDrag}
        onResponderRelease={endDrag}
        onResponderTerminate={endDrag}
      >
        {/* Cell highlight fills (absolute — avoids flex rows collapsing under SVG) */}
        <View style={styles.cellLayer} pointerEvents="none">
          {cells.map((rowCells) =>
            rowCells.map((cell) => {
              const { row, col, isStart } = cell;
              const inPath = pathKeySet.has(`${row},${col}`);
              const isPathHead =
                !!head && head.row === row && head.col === col;

              const highlightStyle = isStart
                ? styles.startCellBackground
                : pathWrong && inPath
                  ? isPathHead
                    ? styles.pathWrongHeadCellBackground
                    : styles.pathWrongCellBackground
                  : isPathHead
                    ? styles.pathHeadCellBackground
                    : inPath
                      ? styles.pathCellBackground
                      : null;

              if (!highlightStyle) {
                return null;
              }

              return (
                <View
                  key={`hl_${row}_${col}`}
                  style={[
                    styles.cellHighlight,
                    {
                      width: cellSize,
                      height: cellSize,
                      left: col * cellSize,
                      top: row * cellSize,
                    },
                    highlightStyle,
                  ]}
                />
              );
            }),
          )}
        </View>

        {/*
          Grid, path, walls, then milestone letters in one SVG.
          Grid lines are drawn here so cells stay visible under a transparent SVG.
        */}
        <Svg
          style={styles.boardSvg}
          width={boardSize}
          height={boardSize}
          pointerEvents="none"
        >
          {gridLines.map((line) => (
            <Line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="#cbd5e1"
              strokeWidth={1}
            />
          ))}

          {localPath.length >= 2 && (
            <Path
              d={pathSvgD}
              stroke={pathWrong ? '#dc2626' : '#6366f1'}
              strokeWidth={tubeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              opacity={0.92}
            />
          )}

          {walls.map((w, i) => {
            const { row1, col1, row2, col2 } = w;
            let x1: number;
            let y1: number;
            let x2: number;
            let y2: number;

            if (row1 === row2 && Math.abs(col1 - col2) === 1) {
              const borderCol = Math.max(col1, col2);
              x1 = borderCol * cellSize;
              x2 = borderCol * cellSize;
              y1 = row1 * cellSize + 2;
              y2 = (row1 + 1) * cellSize - 2;
            } else {
              const borderRow = Math.max(row1, row2);
              x1 = col1 * cellSize + 2;
              x2 = (col1 + 1) * cellSize - 2;
              y1 = borderRow * cellSize;
              y2 = borderRow * cellSize;
            }

            return (
              <Line
                key={`wall_${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#0f172a"
                strokeWidth={7}
                strokeLinecap="round"
              />
            );
          })}

          {letterMarkers.map(({ row, col, letter, isStart }) => {
            const cx = (col + 0.5) * cellSize;
            const cy = (row + 0.5) * cellSize;
            const inPath = pathKeySet.has(`${row},${col}`);
            const isPathHead =
              !!head && head.row === row && head.col === col;

            let fill = '#1e293b';
            let stroke = 'transparent';
            let strokeWidth = 0;
            if (pathWrong && inPath && !isStart) {
              fill = isPathHead ? '#b91c1c' : '#dc2626';
              stroke = '#fecaca';
              strokeWidth = isPathHead ? 3 : 2;
            } else if (isStart) {
              fill = '#15803d';
              stroke = '#bbf7d0';
              strokeWidth = 2;
            } else if (isPathHead) {
              fill = '#4f46e5';
              stroke = '#e0e7ff';
              strokeWidth = 3;
            } else if (inPath) {
              fill = '#4338ca';
              stroke = '#a5b4fc';
              strokeWidth = 2;
            }

            return (
              <G key={`letter_${row}_${col}`}>
                <Circle
                  cx={cx}
                  cy={cy}
                  r={bubbleRadius}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
                <SvgText
                  x={cx}
                  y={cy + letterFontSize * 0.35}
                  fontSize={letterFontSize}
                  fontWeight="800"
                  fill="#ffffff"
                  textAnchor="middle"
                >
                  {letter}
                </SvgText>
                {isStart && (
                  <G>
                    <Rect
                      x={cx - 20}
                      y={row * cellSize + 3}
                      width={40}
                      height={12}
                      rx={4}
                      fill="#16a34a"
                    />
                    <SvgText
                      x={cx}
                      y={row * cellSize + 12}
                      fontSize={8}
                      fontWeight="900"
                      fill="#ffffff"
                      textAnchor="middle"
                      letterSpacing={0.5}
                    >
                      START
                    </SvgText>
                  </G>
                )}
              </G>
            );
          })}
        </Svg>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  boardWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    width: '100%',
  },
  boardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  cellLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  cellHighlight: {
    position: 'absolute',
  },
  boardSvg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  startCellBackground: {
    backgroundColor: '#dcfce7',
  },
  pathCellBackground: {
    backgroundColor: '#eef2ff',
  },
  pathHeadCellBackground: {
    backgroundColor: '#e0e7ff',
  },
  pathWrongCellBackground: {
    backgroundColor: '#fee2e2',
  },
  pathWrongHeadCellBackground: {
    backgroundColor: '#fecaca',
  },
});
