import { createContext, useContext } from "react";
import type { ControlMode } from "@/components/pose/control-mode-parts";

export type Settings = {
  numPlayers: number;
  controlMode: ControlMode;
  compensation: boolean;
};

const defaultSettings: Settings = {
  numPlayers: 1,
  controlMode: "palms",
  compensation: false,
};

export const SettingsContext = createContext<Settings>(defaultSettings);

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

