import { useCallback, useRef } from "react";
import {
  GripVertical,
  Merge,
  Scissors,
  Trash2,
} from "lucide-react";

interface StepCardProps {
  index: number;
  stepId: string;
  title: string;
  tStartMs: number;
  tEndMs: number;
  screenshot: string | null;
  approved: boolean;
  selected: boolean;
  isLast: boolean;
  onClick: () => void;
  onMergeWithNext: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragEnd: () => void;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function StepCard({
  index,
  stepId,
  title,
  tStartMs,
  tEndMs,
  screenshot,
  approved,
  selected,
  isLast,
  onClick,
  onMergeWithNext,
  onSplit,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
}: StepCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", stepId);
      onDragStart(index);
      requestAnimationFrame(() => {
        cardRef.current?.classList.add("dragging");
      });
    },
    [index, stepId, onDragStart]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      onDragOver(index);
    },
    [index, onDragOver]
  );

  const handleDragEnd = useCallback(() => {
    cardRef.current?.classList.remove("dragging");
    onDragEnd();
  }, [onDragEnd]);

  return (
    <div
      ref={cardRef}
      className={`step-card ${selected ? "selected" : ""} ${
        approved ? "approved" : ""
      }`}
      onClick={onClick}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="step-card-drag">
        <GripVertical />
      </div>

      <div className="step-card-number">{index + 1}</div>

      <div className="step-card-content">
        <div className="step-card-title">{title}</div>
        <div className="step-card-time">
          {formatMs(tStartMs)} - {formatMs(tEndMs)}
        </div>
      </div>

      {screenshot && (
        <div className="step-card-thumbnail">
          <img src={screenshot} alt="" />
        </div>
      )}

      <div className="step-card-actions">
        {!isLast && (
          <button
            className="btn btn-icon btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onMergeWithNext();
            }}
            title="Merge with next step"
          >
            <Merge size={12} />
          </button>
        )}
        <button
          className="btn btn-icon btn-ghost btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onSplit();
          }}
          title="Split step"
        >
          <Scissors size={12} />
        </button>
        <button
          className="btn btn-icon btn-danger btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete step"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
