"use client";

import { useEffect, useState } from "react";
import { Drawnix, type DrawnixToolState } from "@drawnix/drawnix";
import type { PlaitElement, PlaitTheme, Viewport } from "@plait/core";
import localforage from "localforage";
import { useI18n } from "@/lib/i18n";

type WhiteboardValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type WhiteboardLanguage = "zh" | "en";

type WhiteboardPreference = {
  copyTransparent: boolean;
  exportTransparent: boolean;
};

const MAIN_BOARD_CONTENT_KEY = "main_board_content";
const MAIN_BOARD_TOOL_STATE_KEY = "main_board_tool_state";
const MAIN_BOARD_PREFERENCE_KEY = "main_board_preference";

localforage.config({
  name: "CoolPilotWhiteboard",
  storeName: "drawnix_store",
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

/** In-app Drawnix whiteboard surface. Language follows the system locale. */
export default function WhiteboardCanvas() {
  const { locale } = useI18n();
  const language: WhiteboardLanguage = locale === "en" ? "en" : "zh";
  const [value, setValue] = useState<WhiteboardValue>({ children: [] });
  const [initialToolState, setInitialToolState] =
    useState<Partial<DrawnixToolState>>();
  const [preference, setPreference] = useState<WhiteboardPreference>({
    copyTransparent: false,
    exportTransparent: false,
  });
  const [loaded, setLoaded] = useState(false);

  const updatePreference = (partialPreference: Partial<WhiteboardPreference>) => {
    setPreference((currentPreference) => {
      const nextPreference = { ...currentPreference, ...partialPreference };
      localforage.setItem(MAIN_BOARD_PREFERENCE_KEY, nextPreference);
      return nextPreference;
    });
  };

  useEffect(() => {
    const loadData = async () => {
      const [storedData, storedToolState, storedPreference] = await Promise.all([
        localforage.getItem(MAIN_BOARD_CONTENT_KEY),
        localforage.getItem(MAIN_BOARD_TOOL_STATE_KEY),
        localforage.getItem(MAIN_BOARD_PREFERENCE_KEY),
      ]);
      if (storedData) {
        const appValue = storedData as WhiteboardValue;
        setValue(appValue);
      }
      if (storedToolState) {
        setInitialToolState(storedToolState as Partial<DrawnixToolState>);
      }
      if (storedPreference) {
        setPreference(storedPreference as WhiteboardPreference);
      }
      setLoaded(true);
    };
    void loadData();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <Drawnix
      key={language}
      value={value.children}
      viewport={value.viewport}
      theme={value.theme}
      initialToolState={initialToolState}
      initialLanguage={language}
      initialPreference={{
        copyTransparent: preference.copyTransparent,
        exportTransparent: preference.exportTransparent,
      }}
      onPreferenceChange={({ copyTransparent, exportTransparent }) => {
        updatePreference({ copyTransparent, exportTransparent });
      }}
      onChange={(nextValue) => {
        const newValue = nextValue as WhiteboardValue;
        localforage.setItem(MAIN_BOARD_CONTENT_KEY, newValue);
        setValue(newValue);
      }}
      onToolStateChange={(toolState) => {
        localforage.setItem(MAIN_BOARD_TOOL_STATE_KEY, toolState);
      }}
    />
  );
}
