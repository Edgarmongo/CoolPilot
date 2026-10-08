import { useEffect, useState } from 'react';
import { useBoard } from '@plait-board/react-board';
import { Dialog, DialogContent } from '../dialog/dialog';
import { DialogType, useDrawnix } from '../../hooks/use-drawnix';
import { useI18n } from '../../i18n';
import { boardToMarkdown } from '../../utils/board-markdown';
import { resolveApiBase } from '../../utils/llm';
import './export-to-library-dialog.scss';

type ExportError = {
  message: string;
  detail?: string;
};

/**
 * Exports the current board to the hosting app's content library.
 *
 * Deliberately a real dialog instead of `window.prompt`: Electron does not
 * implement `window.prompt` (it throws), and the exported body must be the
 * serialised board, not just its title.
 */
export const ExportToLibraryDialog = ({ container }: { container: HTMLElement | null }) => {
  const { appState, setAppState, showToast } = useDrawnix();
  const { t } = useI18n();
  const board = useBoard();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ExportError | null>(null);

  const open = appState.openDialogType === DialogType.exportToLibrary;

  // Serialised from the live board: mind maps as a heading outline, other
  // elements as a bullet list.
  const body = open
    ? boardToMarkdown(board.children, {
        emptyTopic: t('dialog.exportToLibrary.emptyTopic'),
        standaloneSection: t('dialog.exportToLibrary.standaloneSection'),
        textElement: t('dialog.exportToLibrary.element.text'),
        shapeElement: t('dialog.exportToLibrary.element.shape'),
        imageElement: t('dialog.exportToLibrary.element.image'),
      })
    : '';

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(t('dialog.exportToLibrary.defaultTitle'));
    setSubmitting(false);
    setError(null);
  }, [open, t]);

  const close = () => {
    setAppState((currentAppState) => ({
      ...currentAppState,
      openDialogType: null,
    }));
  };

  const handleExport = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError({ message: t('dialog.exportToLibrary.error.titleRequired') });
      return;
    }
    if (!body) {
      setError({ message: t('dialog.exportToLibrary.error.emptyBoard') });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${resolveApiBase()}/api/content/whiteboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle, body }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${(await response.text()).slice(0, 200)}`);
      }
      showToast({
        message: t('toast.exportToLibrary.success'),
        description: trimmedTitle,
        type: 'success',
      });
      close();
    } catch (err) {
      setError({
        message: t('dialog.exportToLibrary.error.submit'),
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setAppState((currentAppState) => ({
          ...currentAppState,
          openDialogType: nextOpen ? DialogType.exportToLibrary : null,
        }));
      }}
    >
      <DialogContent className="Dialog export-to-library-dialog" container={container}>
        <h2 className="export-to-library-dialog__title">
          {t('dialog.exportToLibrary.action')}
        </h2>
        <p className="export-to-library-dialog__description">
          {t('dialog.exportToLibrary.description')}
        </p>
        <label className="export-to-library-dialog__label" htmlFor="export-to-library-title">
          {t('dialog.exportToLibrary.titleLabel')}
        </label>
        <input
          id="export-to-library-title"
          className="export-to-library-dialog__input"
          data-testid="export-to-library-title"
          type="text"
          value={title}
          placeholder={t('dialog.exportToLibrary.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="export-to-library-dialog__label">
          {t('dialog.exportToLibrary.bodyLabel')}
        </div>
        {body ? (
          <pre className="export-to-library-dialog__preview" data-testid="export-to-library-preview">
            {body}
          </pre>
        ) : (
          <div className="export-to-library-dialog__empty" data-testid="export-to-library-empty">
            {t('dialog.exportToLibrary.emptyBoard')}
          </div>
        )}
        {error && (
          <div className="export-to-library-dialog__error" role="alert">
            <div className="export-to-library-dialog__error-message">{error.message}</div>
            {error.detail && (
              <div className="export-to-library-dialog__error-detail">{error.detail}</div>
            )}
          </div>
        )}
        <div className="export-to-library-dialog__actions">
          <button
            className="export-to-library-dialog__button export-to-library-dialog__button--cancel"
            data-testid="export-to-library-cancel"
            type="button"
            onClick={close}
          >
            {t('dialog.exportToLibrary.cancel')}
          </button>
          <button
            className="export-to-library-dialog__button export-to-library-dialog__button--submit"
            data-testid="export-to-library-submit"
            type="button"
            disabled={submitting || !body}
            onClick={handleExport}
          >
            {submitting ? t('dialog.exportToLibrary.exporting') : t('dialog.exportToLibrary.action')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
