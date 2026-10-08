import { useBoard } from '@plait-board/react-board';
import classNames from 'classnames';
import { ATTACHED_ELEMENT_CLASS_NAME, BoardTransforms, ThemeColorMode } from '@plait/core';
import { Island } from '../island';
import { useI18n } from '../../i18n';
import { ROUGHNESS_OPTIONS, getRoughnessPreference, setRoughnessPreference } from '../../utils/roughness';

export const ThemeToolbar = () => {
  const board = useBoard();
  const { t } = useI18n();
  const theme = board.theme;
  return (
    <Island padding={1} className={classNames('theme-toolbar', ATTACHED_ELEMENT_CLASS_NAME)}>
      <select
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          BoardTransforms.updateThemeColor(board, value as ThemeColorMode);
        }}
        value={theme.themeColorMode}
      >
        <option value="default">{t('theme.default')}</option>
        <option value="colorful">{t('theme.colorful')}</option>
        <option value="soft">{t('theme.soft')}</option>
        <option value="retro">{t('theme.retro')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="starry">{t('theme.starry')}</option>
      </select>
      <select
        className="roughness-select"
        onChange={(e) => {
          const value = parseFloat((e.target as HTMLSelectElement).value);
          setRoughnessPreference(value);
          window.location.reload();
        }}
        value={String(getRoughnessPreference())}
        title="手绘强度"
      >
        {ROUGHNESS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Island>
  );
};
