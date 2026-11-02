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
const boardHelp = (paused: boolean, interactive: boolean): string => {
  if (paused) {
    return "Your try is shown. Choose Try again or Reveal.";
  }
  if (interactive) {
    return "Drag a piece, or select it and its destination. Keyboard move entry is available below.";
  }
  return "End of the selected line.";
};
const annotationKey = "autoShapes";
const noArrows: readonly { from: string; to: string; color: string }[] = [];
/**
 * Render a Chessground position and forward legal pointer moves.
 * @param props - Component inputs and event callbacks.
 * @returns Render a Chessground position and forward legal pointer moves.
 */
export const Board = ({
  fen,
  orientation,
  interactive,
  promotion,
  onMove,
  paused = false,
  arrows = noArrows,
}: BoardProps) => {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!element.current) {
      return () => {
        /* No renderer was created, so this effect has no cleanup. */
      };
    }
    const pos = positionFromFen(fen);
    const board = Chessground(element.current, {
      animation: {
        enabled: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      blockTouchScroll: interactive,
      check: pos.isCheck(),
      coordinates: true,
      draggable: { enabled: interactive },
      drawable: {
        [annotationKey]: arrows.flatMap((arrow) => {
          const from = parseSquare(arrow.from);
          const to = parseSquare(arrow.to);
          return from === undefined || to === undefined
            ? []
            : [
                {
                  brush: arrow.color,
                  dest: makeSquare(to),
                  orig: makeSquare(from),
                },
              ];
        }),
        enabled: true,
        visible: true,
      },
      fen,
      movable: {
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
        free: false,
      },
      orientation,
      premovable: { enabled: false },
      selectable: { enabled: interactive },
      turnColor: pos.turn,
      viewOnly: !interactive,
    });
    return () => {
      board.destroy();
    };
  }, [fen, orientation, interactive, promotion, onMove, arrows]);
  return (
    <div className="lesson-board">
      <figure
        ref={element}
        className="cg-wrap"
        aria-label={`Chess position. ${fen}. ${boardHelp(paused, interactive)}`}
      />
    </div>
  );
};
