import type { ActionState, Area, Reading } from "../types";

/**
 * The only seam between the UI and wherever readings come from.
 * SampleDataSource: simulated, no backend. HttpDataSource: the MOIST API (local server or AWS).
 */
export interface DataSource {
  readonly label: string;
  readonly isSimulated: boolean;
  loadAreas(): Promise<Area[]>;
  loadReadings(): Promise<Reading[]>;
  subscribe(onReading: (r: Reading) => void): () => void;
  loadActions?(): Promise<Record<string, ActionState>>;
  saveAction?(key: string, state: ActionState): Promise<void>;
}
