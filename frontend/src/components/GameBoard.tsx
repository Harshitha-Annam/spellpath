import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import Svg, { Path, Line, Circle, G, Rect, Text as SvgText } from 'react-native-svg';
import {
  GestureDetector,
  GestureStateManager,
  usePanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { PuzzleData, GridPos } from '../types';
import { getWallKey } from '../puzzleGenerator';
import { areMilestonesSequential } from '../scoring';
import { LIGHT_SPRING, SNAP_SPRING } from '../animations/springConfig';
import {
  buildCellCenterPathD,
  projectOrthogonalTip,
} from '../utils/zipPathGeometry';

const AnimatedPath = Animated.createAnimatedComponent(Path);

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
  /** Visual theme — Jupiter live duel uses coral/orange accents. */
  accent?: 'default' | 'jupiter';
}

const ACCENT_PALETTE = {
  default: {
    path: '#7c6cff',
    pathHead: '#7c6cff',
    pathMid: '#5b4fcf',
    pathHeadStroke: '#c4b5fd',
    pathMidStroke: '#a5b4fc',
    pathCellBg: 'rgba(124, 108, 255, 0.18)',
    pathHeadCellBg: 'rgba(124, 108, 255, 0.32)',
    boardBg: '#1a1a28',
    boardBorder: '#2a2a3a',
    gridLine: '#2a2a3a',
  },
  jupiter: {
    path: '#e85a3c',
    pathHead: '#e85a3c',
    pathMid: '#c94a32',
    pathHeadStroke: '#f5a38f',
    pathMidStroke: '#e88a72',
    pathCellBg: 'rgba(232, 90, 60, 0.18)',
    pathHeadCellBg: 'rgba(232, 90, 60, 0.32)',
    boardBg: '#1c1c1c',
    boardBorder: '#2e2e2e',
    gridLine: '#2e2e2e',
  },
} as const;

function sameCell(a: GridPos, b: GridPos) {
  return a.row === b.row && a.col === b.col;
}

function cellKey(p: GridPos) {
  return `${p.row},${p.col}`;
}

function cellCenter(p: GridPos, size: number) {
  return {
    x: (p.col + 0.5) * size,
    y: (p.row + 0.5) * size,
  };
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
  accent = 'default',
}) => {
  const { gridSize, cells, walls, startCell, milestones } = puzzle;
  const colors = ACCENT_PALETTE[accent];

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

  // Local path drives cell highlights / committed SVG; parent ≤ once per frame.
  const [localPath, setLocalPath] = useState<GridPos[]>(() => [startCell]);
  const pathRef = useRef<GridPos[]>([startCell]);
  const visitedRef = useRef<Set<string>>(new Set([cellKey(startCell)]));

  const pointerDownRef = useRef(false);
  const dragActiveRef = useRef(false);
  const drawArmedRef = useRef(false);
  const pressStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastStrokeRef = useRef<{ x: number; y: number } | null>(null);
  const pendingCommitRef = useRef<GridPos[] | null>(null);
  const commitRafRef = useRef<number | null>(null);
  const lockedRef = useRef(interactionLocked);
  lockedRef.current = interactionLocked;
  const puzzleIdRef = useRef<string | null>(null);
  /** Dedupe miss/backtrack while finger stays on the same invalid/prev cell. */
  const lastStatsCellRef = useRef<string | null>(null);
  /**
   * Armed illegal cell from a stroke endpoint. Corner clips during
   * interpolation must not count; a miss only commits after a second
   * consecutive terminal hit on the same illegal cell.
   */
  const pendingMissRef = useRef<string | null>(null);
  const onMissRef = useRef(onMiss);
  const onBacktrackRef = useRef(onBacktrack);
  const onDragChangeRef = useRef(onDragChange);
  const scrollLockRef = useRef(false);
  onMissRef.current = onMiss;
  onBacktrackRef.current = onBacktrack;
  onDragChangeRef.current = onDragChange;

  // UI-thread geometry: Zip corridor tip (orthogonal only — never free diagonal).
  const startCenter = cellCenter(startCell, cellSize);
  const headX = useSharedValue(startCenter.x);
  const headY = useSharedValue(startCenter.y);
  const tipX = useSharedValue(startCenter.x);
  const tipY = useSharedValue(startCenter.y);
  const tipActive = useSharedValue(0);
  const committedPathD = useSharedValue('');
  const lockedSV = useSharedValue(interactionLocked ? 1 : 0);
  const headRowSV = useSharedValue(startCell.row);
  const headColSV = useSharedValue(startCell.col);
  const cellSizeSV = useSharedValue(cellSize);
  const boardSizeSV = useSharedValue(boardSize);
  const armedSV = useSharedValue(0);
  const gestureActiveSV = useSharedValue(0);
  const startTouchX = useSharedValue(0);
  const startTouchY = useSharedValue(0);

  useEffect(() => {
    lockedSV.value = interactionLocked ? 1 : 0;
  }, [interactionLocked, lockedSV]);

  useEffect(() => {
    cellSizeSV.value = cellSize;
    boardSizeSV.value = boardSize;
  }, [cellSize, boardSize, cellSizeSV, boardSizeSV]);

  const syncHeadShared = useCallback(
    (head: GridPos, springTip: boolean) => {
      const { x, y } = cellCenter(head, cellSize);
      headX.value = x;
      headY.value = y;
      headRowSV.value = head.row;
      headColSV.value = head.col;
      if (springTip) {
        tipX.value = withSpring(x, LIGHT_SPRING);
        tipY.value = withSpring(y, LIGHT_SPRING);
      } else {
        tipX.value = x;
        tipY.value = y;
      }
    },
    [cellSize, headX, headY, headRowSV, headColSV, tipX, tipY],
  );

  const syncCommittedPathD = useCallback(
    (cells: GridPos[]) => {
      committedPathD.value = buildCellCenterPathD(cells, cellSize);
    },
    [cellSize, committedPathD],
  );

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
      const head = next[next.length - 1] ?? startCell;
      tipActive.value = 0;
      syncCommittedPathD(next);
      syncHeadShared(head, false);
    },
    [startCell, syncCommittedPathD, syncHeadShared, tipActive],
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
    drawArmedRef.current = false;
    pressStartRef.current = null;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;
    pendingMissRef.current = null;
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
    const head = path[path.length - 1] ?? startCell;
    tipActive.value = 0;
    syncCommittedPathD(path);
    syncHeadShared(head, false);
  }, [path, startCell, syncCommittedPathD, syncHeadShared, tipActive]);

  useEffect(() => {
    return () => {
      cancelPendingCommit();
    };
  }, [cancelPendingCommit]);

  // Keep head + committed stroke aligned when the path grows/shrinks mid-drag.
  useEffect(() => {
    if (localPath.length === 0) {
      return;
    }
    const head = localPath[localPath.length - 1];
    const { x, y } = cellCenter(head, cellSize);
    headX.value = x;
    headY.value = y;
    headRowSV.value = head.row;
    headColSV.value = head.col;
    syncCommittedPathD(localPath);
    // Tip keeps following the corridor while dragging; snap only when idle.
    if (!pointerDownRef.current) {
      tipX.value = x;
      tipY.value = y;
      tipActive.value = 0;
    }
  }, [
    localPath,
    cellSize,
    headX,
    headY,
    headRowSV,
    headColSV,
    tipX,
    tipY,
    tipActive,
    syncCommittedPathD,
  ]);

  const onLayout = useCallback((_e: LayoutChangeEvent) => {
    // Board is self-sized; gesture coords are view-local via GestureDetector.
  }, []);

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

  /**
   * Only enter the cell under the finger — never chase distant cells.
   * @param recordMiss When false (interpolated stroke samples), illegal
   * adjacent cells are ignored so corner clips do not inflate misses.
   * When true (actual finger endpoint), arm/confirm a pending miss.
   */
  const tryEnterCell = (target: GridPos, recordMiss = false) => {
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
        pendingMissRef.current = null;
        scheduleCommit(next);
      }
      return;
    }

    const head = current[current.length - 1];
    if (sameCell(head, target)) {
      lastStatsCellRef.current = null;
      pendingMissRef.current = null;
      return;
    }

    const targetKey = cellKey(target);

    // Undo one step when dragging back onto the previous cell.
    if (current.length >= 2 && sameCell(current[current.length - 2], target)) {
      pendingMissRef.current = null;
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
      pendingMissRef.current = null;
      const next = [...current, target];
      pathRef.current = next;
      visitedRef.current.add(cellKey(target));
      scheduleCommit(next);
      return;
    }

    // Adjacent but illegal (wall or revisit). Ignore mid-stroke clips;
    // only arm/confirm from the real finger endpoint.
    if (!recordMiss) {
      return;
    }

    if (pendingMissRef.current === targetKey) {
      if (lastStatsCellRef.current !== `miss:${targetKey}`) {
        lastStatsCellRef.current = `miss:${targetKey}`;
        onMissRef.current?.();
      }
      return;
    }

    pendingMissRef.current = targetKey;
  };

  /**
   * Sample along the finger stroke so fast swipes still fill adjacent cells
   * the pointer crossed — without a rubber-band stick or sideways elongation.
   * Only the stroke endpoint may record a miss (avoids corner-clip false misses).
   */
  const handleStroke = (x: number, y: number) => {
    const prev = lastStrokeRef.current;
    lastStrokeRef.current = { x, y };

    if (!prev) {
      const cell = cellAt(x, y);
      if (cell) {
        tryEnterCell(cell, true);
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
        tryEnterCell(cell, i === steps);
      }
    }
  };

  const beginArmedTouch = useCallback(
    (x: number, y: number) => {
      if (lockedRef.current) {
        return;
      }
      pressStartRef.current = { x, y };
      pointerDownRef.current = true;
      dragActiveRef.current = false;
      drawArmedRef.current = true;
      lastStrokeRef.current = null;
      lastStatsCellRef.current = null;
      pendingMissRef.current = null;
      setParentScrollLock(true);
    },
    [setParentScrollLock],
  );

  const activateDragStroke = useCallback((x: number, y: number) => {
    dragActiveRef.current = true;
    const start = pressStartRef.current;
    lastStrokeRef.current = start ?? { x, y };
  }, []);

  const moveDragStroke = useCallback(
    (x: number, y: number) => {
      if (lockedRef.current || !pointerDownRef.current || !drawArmedRef.current) {
        return;
      }
      if (!dragActiveRef.current) {
        activateDragStroke(x, y);
      }
      handleStroke(x, y);
    },
    // handleStroke closes over latest cellSize / refs; intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activateDragStroke, cellSize, gridSize, startCell, wallSet],
  );

  const endDragStroke = useCallback(() => {
    if (!pointerDownRef.current) {
      drawArmedRef.current = false;
      tipActive.value = 0;
      return;
    }
    pointerDownRef.current = false;
    dragActiveRef.current = false;
    drawArmedRef.current = false;
    pressStartRef.current = null;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;
    pendingMissRef.current = null;

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

    const head = pathRef.current[pathRef.current.length - 1];
    if (head) {
      const { x, y } = cellCenter(head, cellSize);
      tipX.value = withSpring(x, SNAP_SPRING);
      tipY.value = withSpring(y, SNAP_SPRING);
      headX.value = x;
      headY.value = y;
    }
    tipActive.value = 0;

    setParentScrollLock(false);
  }, [
    cellSize,
    headX,
    headY,
    onPathChange,
    setParentScrollLock,
    tipActive,
    tipX,
    tipY,
  ]);

  const clearArmedWithoutDrag = useCallback(() => {
    pointerDownRef.current = false;
    dragActiveRef.current = false;
    drawArmedRef.current = false;
    pressStartRef.current = null;
    lastStrokeRef.current = null;
    lastStatsCellRef.current = null;
    pendingMissRef.current = null;
    tipActive.value = 0;
    setParentScrollLock(false);
  }, [setParentScrollLock, tipActive]);

  const setOrthogonalTip = (fingerX: number, fingerY: number) => {
    'worklet';
    // Track the corridor 1:1 while dragging (Zip feel). Spring only on release snap.
    const projected = projectOrthogonalTip(
      headX.value,
      headY.value,
      fingerX,
      fingerY,
      cellSizeSV.value,
    );
    tipActive.value = 1;
    tipX.value = projected.x;
    tipY.value = projected.y;
  };

  const panGesture = usePanGesture({
    manualActivation: true,
    onTouchesDown: (e) => {
      'worklet';
      if (lockedSV.value) {
        armedSV.value = 0;
        gestureActiveSV.value = 0;
        GestureStateManager.fail(e.handlerTag);
        return;
      }
      const t = e.allTouches[0];
      if (!t) {
        armedSV.value = 0;
        gestureActiveSV.value = 0;
        GestureStateManager.fail(e.handlerTag);
        return;
      }
      const col = Math.floor(t.x / cellSizeSV.value);
      const row = Math.floor(t.y / cellSizeSV.value);
      if (row === headRowSV.value && col === headColSV.value) {
        armedSV.value = 1;
        gestureActiveSV.value = 0;
        startTouchX.value = t.x;
        startTouchY.value = t.y;
        tipX.value = headX.value;
        tipY.value = headY.value;
        tipActive.value = 0;
        runOnJS(beginArmedTouch)(t.x, t.y);
      } else {
        armedSV.value = 0;
        gestureActiveSV.value = 0;
        GestureStateManager.fail(e.handlerTag);
      }
    },
    onTouchesMove: (e) => {
      'worklet';
      if (armedSV.value !== 1 || gestureActiveSV.value === 1) {
        return;
      }
      const t = e.allTouches[0];
      if (!t) {
        return;
      }
      const dist = Math.hypot(t.x - startTouchX.value, t.y - startTouchY.value);
      if (dist >= DRAG_ACTIVATE_PX) {
        gestureActiveSV.value = 1;
        setOrthogonalTip(t.x, t.y);
        runOnJS(activateDragStroke)(t.x, t.y);
        GestureStateManager.activate(e.handlerTag);
      }
    },
    onTouchesUp: (e) => {
      'worklet';
      if (armedSV.value === 1 && gestureActiveSV.value !== 1) {
        armedSV.value = 0;
        tipActive.value = 0;
        runOnJS(clearArmedWithoutDrag)();
        GestureStateManager.fail(e.handlerTag);
      }
    },
    onTouchesCancel: (e) => {
      'worklet';
      armedSV.value = 0;
      gestureActiveSV.value = 0;
      tipActive.value = 0;
      runOnJS(clearArmedWithoutDrag)();
      GestureStateManager.fail(e.handlerTag);
    },
    onUpdate: (e) => {
      'worklet';
      const x = Math.max(0, Math.min(boardSizeSV.value, e.x));
      const y = Math.max(0, Math.min(boardSizeSV.value, e.y));
      // Zip: tip stays on the row/column corridor from the head (no diagonals).
      setOrthogonalTip(x, y);
      runOnJS(moveDragStroke)(x, y);
    },
    onDeactivate: () => {
      'worklet';
      armedSV.value = 0;
      gestureActiveSV.value = 0;
      runOnJS(endDragStroke)();
    },
    onFinalize: (e) => {
      'worklet';
      armedSV.value = 0;
      gestureActiveSV.value = 0;
      if (e.canceled) {
        // Failed / cancelled paths already cleared via touches handlers.
      }
    },
  });

  // One continuous Zip stroke: committed cell centers + short orthogonal live tip.
  const animatedPathProps = useAnimatedProps(() => {
    const base = committedPathD.value;
    const dx = tipX.value - headX.value;
    const dy = tipY.value - headY.value;
    const tipOut =
      tipActive.value > 0.5 && dx * dx + dy * dy > 0.25;

    if (!base && !tipOut) {
      return { d: '', opacity: 0 };
    }

    let d = base;
    if (tipOut) {
      if (!d) {
        d = `M ${headX.value} ${headY.value}`;
      }
      d += ` L ${tipX.value} ${tipY.value}`;
    }

    return { d, opacity: 0.95 };
  });

  const pathKeySet = useMemo(() => {
    const set = new Set<string>();
    for (const p of localPath) {
      set.add(cellKey(p));
    }
    return set;
  }, [localPath]);

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

  const pathStroke = pathWrong ? '#ff6b6b' : colors.path;

  return (
    <View style={styles.boardWrapper}>
      <GestureDetector gesture={panGesture}>
        <View
          collapsable={false}
          onLayout={onLayout}
          style={[
            styles.boardContainer,
            {
              width: boardSize,
              height: boardSize,
              backgroundColor: colors.boardBg,
              borderColor: colors.boardBorder,
            },
          ]}
        >
          {/* Cell highlight fills (absolute — avoids flex rows collapsing under SVG) */}
          <View style={styles.cellLayer} pointerEvents="none">
            {cells.map((rowCells) =>
              rowCells.map((cell) => {
                const { row, col, isStart } = cell;
                const inPath = pathKeySet.has(`${row},${col}`);
                const isPathHead =
                  !!head && head.row === row && head.col === col;

                let highlightStyle = null;
                let highlightColor: string | undefined;
                if (isStart) {
                  highlightStyle = styles.startCellBackground;
                } else if (pathWrong && inPath) {
                  highlightStyle = isPathHead
                    ? styles.pathWrongHeadCellBackground
                    : styles.pathWrongCellBackground;
                } else if (isPathHead) {
                  highlightColor = colors.pathHeadCellBg;
                } else if (inPath) {
                  highlightColor = colors.pathCellBg;
                }

                if (!highlightStyle && !highlightColor) {
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
                        ...(highlightColor ? { backgroundColor: highlightColor } : null),
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
                stroke={colors.gridLine}
                strokeWidth={1}
              />
            ))}

            {/* One continuous Zip-style tube (orthogonal cell centers + live tip). */}
            <AnimatedPath
              animatedProps={animatedPathProps}
              stroke={pathStroke}
              strokeWidth={tubeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />

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
                  stroke="#f5f5ff"
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

              let fill = '#ccc';
              let stroke = 'transparent';
              let strokeWidth = 0;
              if (pathWrong && inPath && !isStart) {
                fill = isPathHead ? '#b91c1c' : '#ff6b6b';
                stroke = '#fecaca';
                strokeWidth = isPathHead ? 3 : 2;
              } else if (isStart) {
                fill = '#15803d';
                stroke = '#4ade80';
                strokeWidth = 2;
              } else if (isPathHead) {
                fill = colors.pathHead;
                stroke = colors.pathHeadStroke;
                strokeWidth = 3;
              } else if (inPath) {
                fill = colors.pathMid;
                stroke = colors.pathMidStroke;
                strokeWidth = 2;
              } else if (accent === 'jupiter' && letter) {
                fill = '#111111';
                stroke = '#3a3a3a';
                strokeWidth = 1;
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
      </GestureDetector>
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
    backgroundColor: '#1a1a28',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#2a2a3a',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 5,
  },
  cellLayer: {
    ...StyleSheet.absoluteFill,
  },
  cellHighlight: {
    position: 'absolute',
  },
  boardSvg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  startCellBackground: {
    backgroundColor: 'rgba(74, 222, 128, 0.18)',
  },
  pathCellBackground: {
    backgroundColor: 'rgba(124, 108, 255, 0.18)',
  },
  pathHeadCellBackground: {
    backgroundColor: 'rgba(124, 108, 255, 0.32)',
  },
  pathWrongCellBackground: {
    backgroundColor: 'rgba(255, 107, 107, 0.2)',
  },
  pathWrongHeadCellBackground: {
    backgroundColor: 'rgba(255, 107, 107, 0.35)',
  },
});
