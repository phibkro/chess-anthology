import { Chessground } from "@lichess-org/chessground";
import { chessgroundDests } from "chessops/compat";
import { makeSquare, parseSquare } from "chessops/util";
import { useEffect, useRef } from "react";

import { positionFromFen } from "./chess";

import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";

interface BoardProps {
  fen: string;
  orientation: "white" | "black";
  interactive: boolean;
  attempt: number;
  paused?: boolean;
  promotion: string;
  onMove: (uci: string) => void;
  arrows?: readonly { from: string; to: string; color: string }[];
}
const noArrows: readonly { from: string; to: string; color: string }[] = [];
export function Board({
  fen,
  orientation,
  interactive,
  attempt,
  promotion,
  onMove,
  paused = false,
  arrows = noArrows,
}: BoardProps) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current) return;
    const pos = positionFromFen(fen);
    const board = Chessground(element.current, {
      fen,
      orientation,
      turnColor: pos.turn,
      check: pos.isCheck(),
      animation: {
        enabled: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      coordinates: true,
      blockTouchScroll: interactive,
      viewOnly: !interactive,
      movable: {
        free: false,
        color: interactive ? pos.turn : undefined,
        dests: interactive ? chessgroundDests(pos) : new Map(),
        events: {
          after: (from, to) => {
            const piece = board.state.pieces.get(to);
            const promote =
              piece?.role === "pawn" && (to[1] === "1" || to[1] === "8");
            onMove(from + to + (promote ? promotion : ""));
          },
        },
      },
      draggable: { enabled: interactive },
      selectable: { enabled: interactive },
      premovable: { enabled: false },
      drawable: {
        enabled: true,
        visible: true,
        autoShapes: arrows.flatMap((arrow) => {
          const from = parseSquare(arrow.from);
          const to = parseSquare(arrow.to);
          return from === undefined || to === undefined
            ? []
            : [
                {
                  orig: makeSquare(from),
                  dest: makeSquare(to),
                  brush: arrow.color,
                },
              ];
        }),
      },
    });
    return () => board.destroy();
  }, [fen, orientation, interactive, attempt, promotion, onMove, arrows]);
  return (
    <div className="lesson-board">
      <div
        ref={element}
        className="cg-wrap"
        role="img"
        aria-label={`Chess position. ${fen}. ${paused ? "Your try is shown. Choose Try again or Reveal." : interactive ? "Drag a piece, or select it and its destination. Keyboard move entry is available below." : "End of the selected line."}`}
      />
    </div>
  );
}
