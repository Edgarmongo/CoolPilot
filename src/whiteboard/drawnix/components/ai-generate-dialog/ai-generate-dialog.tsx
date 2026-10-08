import { useState } from 'react';
import { Dialog, DialogContent } from '../dialog/dialog';
import { DialogType, useDrawnix } from '../../hooks/use-drawnix';
import { useBoard } from '@plait-board/react-board';
import {
  generateMindMapMarkdownStream,
} from '../../utils/llm';
import { getViewportOrigination, PlaitBoard, WritableClipboardOperationType } from '@plait/core';
import type { MindElement } from '@plait/mind';
import { useI18n } from '../../i18n';

type GenerateError = {
  message: string;
  detail?: string;
};

export const AIGenerateDialog = ({ container }: { container: HTMLElement | null }) => {
  const { appState, setAppState } = useDrawnix();
  const { t } = useI18n();
  const board = useBoard();
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState<GenerateError | null>(null);

  const close = () => {
    setAppState((currentAppState) => ({
      ...currentAppState,
      openDialogType: null,
    }));
  };

  const detailOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError({ message: t('dialog.aiGenerate.error.topicRequired') });
      return;
    }
    setGenerating(true);
    setError(null);
    setMarkdown('');
    try {
      const result = await generateMindMapMarkdownStream(topic.trim(), (text) => {
        setMarkdown(text);
      });
      setMarkdown(result);
    } catch (err) {
      setError({
        message: t('dialog.aiGenerate.error.generate'),
        detail: detailOf(err),
      });
    } finally {
      setGenerating(false);
    }
  };

  const insertToBoard = async () => {
    if (!markdown.trim()) {
      return;
    }
    try {
      const module = await import('@plait-board/markdown-to-drawnix');
      const mind: MindElement = await module.parseMarkdownToDrawnix(markdown);
      mind.points = [[0, 0]];
      const boardContainerRect = PlaitBoard.getBoardContainer(board).getBoundingClientRect();
      const focusPoint = [boardContainerRect.width / 4, boardContainerRect.height / 2 - 20];
      const zoom = board.viewport.zoom;
      const origination = getViewportOrigination(board);
      const focusX = origination![0] + focusPoint[0] / zoom;
      const focusY = origination![1] + focusPoint[1] / zoom;
      board.insertFragment(
        { elements: [mind] },
        [focusX, focusY],
        WritableClipboardOperationType.paste
      );
      close();
    } catch (err) {
      setError({
        message: t('dialog.aiGenerate.error.insert'),
        detail: detailOf(err),
      });
    }
  };

  return (
    <Dialog
      open={appState.openDialogType === DialogType.aiGenerate}
      onOpenChange={(open) => {
        setAppState((currentAppState) => ({
          ...currentAppState,
          openDialogType: open ? DialogType.aiGenerate : null,
        }));
      }}
    >
      <DialogContent className="Dialog ttd-dialog" container={container}>
        <div className="ai-generate-dialog">
          <div className="ttd-dialog-desc">{t('dialog.aiGenerate.description')}</div>
          <div className="ttd-ai-generate">
            <textarea
              className="ttd-ai-topic"
              data-testid="ai-generate-topic"
              placeholder={t('dialog.aiGenerate.placeholder')}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={2}
            />
            <button
              className="ttd-ai-button"
              data-testid="ai-generate-submit"
              type="button"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? t('dialog.aiGenerate.generating') : t('dialog.aiGenerate.action')}
            </button>
            {error && (
              <div className="ttd-ai-error" role="alert">
                <div>{error.message}</div>
                {error.detail && <div className="ttd-ai-error-detail">{error.detail}</div>}
              </div>
            )}
            {markdown && (
              <div className="ai-generate-preview">
                <div className="ai-generate-preview-label">{t('dialog.aiGenerate.previewLabel')}</div>
                <pre className="ai-generate-markdown" data-testid="ai-generate-preview">
                  {markdown}
                </pre>
                <button
                  className="ttd-ai-button"
                  data-testid="ai-generate-insert"
                  type="button"
                  onClick={insertToBoard}
                  disabled={generating}
                >
                  {t('dialog.aiGenerate.insert')}
                </button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
