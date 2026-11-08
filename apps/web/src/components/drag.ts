/**
 * Drag & drop on pointer events, so it works the same with a mouse and a finger (HTML5 drag & drop
 * does not work on phones). A drag starts after the pointer moves a few pixels; a copy of the card
 * follows the pointer; the drop target is the element under the pointer marked with `data-drop`.
 */

const THRESHOLD = 8;
let suppressUntil = 0;

/** True right after a drag or a long press: the click that follows must be ignored. */
export function clickSuppressed(): boolean {
  return Date.now() < suppressUntil;
}
export function suppressNextClick() {
  suppressUntil = Date.now() + 350;
}

function dropTargetAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return (el?.closest("[data-drop]") as HTMLElement | null) ?? null;
}

export function startPointerDrag(
  e: PointerEvent,
  source: HTMLElement,
  handlers: { onStart: () => void; onDrop: (target: HTMLElement | null) => void },
) {
  const startX = e.clientX;
  const startY = e.clientY;
  const pointerId = e.pointerId;
  let ghost: HTMLElement | null = null;
  let over: HTMLElement | null = null;
  let dx = 0;
  let dy = 0;

  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
      handlers.onStart();
      const r = source.getBoundingClientRect();
      dx = startX - r.left;
      dy = startY - r.top;
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      ghost.style.width = `${r.width}px`;
      ghost.style.height = `${r.height}px`;
      document.body.appendChild(ghost);
      source.classList.add("drag-source");
    }
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX - dx}px, ${ev.clientY - dy}px)`;
    const t = dropTargetAt(ev.clientX, ev.clientY);
    if (t !== over) {
      over?.classList.remove("drop-over");
      t?.classList.add("drop-over");
      over = t;
    }
  };
  const end = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (!ghost) return;
    ghost.remove();
    source.classList.remove("drag-source");
    over?.classList.remove("drop-over");
    suppressNextClick();
    handlers.onDrop(ev.type === "pointerup" ? dropTargetAt(ev.clientX, ev.clientY) : null);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
