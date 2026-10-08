const ROUGHNESS_STORAGE_KEY = 'coolskyaimind_roughness';

export const ROUGHNESS_OPTIONS = [
  { value: 1.5, label: '手绘·轻' },
  { value: 2, label: '手绘·标准' },
  { value: 2.5, label: '手绘·重' },
  { value: 3, label: '手绘·很重' },
] as const;

export const getRoughnessPreference = (): number => {
  try {
    const value = localStorage.getItem(ROUGHNESS_STORAGE_KEY);
    const parsed = value ? parseFloat(value) : 1.5;
    return ROUGHNESS_OPTIONS.some((o) => o.value === parsed) ? parsed : 1.5;
  } catch {
    return 1.5;
  }
};

export const setRoughnessPreference = (roughness: number) => {
  try {
    localStorage.setItem(ROUGHNESS_STORAGE_KEY, String(roughness));
  } catch {
    // ignore
  }
};
