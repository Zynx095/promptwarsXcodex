// Modal sheet: rises from the bottom edge on phones, centred dialog on wider screens.
// Traps focus while open, closes on Escape or a backdrop press, and returns focus to the
// element that opened it. It renders into the shell's overlay layer: glass panels use
// backdrop-filter, which makes them the containing block for fixed descendants, so a sheet
// opened from inside a panel (the time card, a table row, the top bar) would otherwise be
// positioned and clipped by that panel instead of the viewport.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

const OVERLAY_LAYER_ID = 'fs-overlays';

/** Where sheets render. Each shell (worker, console, sign-in) places one, outside any glass panel. */
export function OverlayLayer() {
  return <div id={OVERLAY_LAYER_ID} className="overlay-layer" />;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  role = 'dialog',
  initialFocus,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  /** Element to focus when the sheet opens; defaults to the sheet itself so its title is announced. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** When false, Escape and the backdrop do not close the sheet (e.g. while a request is running). */
  dismissible?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    (initialFocus?.current ?? panel)?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const sheet = (
    <div
      className="sheet-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissibleRef.current) onClose();
      }}
    >
      <div ref={panelRef} className={`sheet ${className ?? ''}`} role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          {dismissible ? (
            <button type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>
              <X className="icon" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {children}
        {footer ? <div className="sheet-footer">{footer}</div> : null}
      </div>
    </div>
  );
  const layer = document.getElementById(OVERLAY_LAYER_ID);
  return layer ? createPortal(sheet, layer) : sheet;
}
