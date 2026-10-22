// Vertrag zwischen Main-Prozess (preload.js) und Flowbase-Oberfläche.
// Einzige Schnittstelle der Renderer: window.flowbase. Nichts anderes wird exponiert.

export type Slot = "A" | "B" | "C"; // A = Diktat, B = Text → Sprachnachricht, C = Sprechen → Sprachnachricht

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface Session {
  loggedIn: boolean;
  email?: string;
  name?: string;
  activeModelId?: string | null;
}

export interface FlowbaseModel {
  id: string;
  name: string;
}

export interface StatusEvent {
  slot: Slot;
  phase: "recording" | "working" | "done" | "error";
  message: string; // deutscher Text für den Nutzer, echte Umlaute
}

export interface FlowbaseBridge {
  getSession(): Promise<Session>;
  login(email: string, password: string): Promise<Result<{ session: Session }>>;
  logout(): Promise<Result>;
  listModels(): Promise<Result<{ models: FlowbaseModel[] }>>;
  setActiveModel(modelId: string): Promise<Result>;

  /** Electron-Accelerator je Kürzel, "" = aus. */
  getShortcuts(): Promise<Record<Slot, string>>;
  /** Registriert sofort global; Fehler z. B. „Kürzel ist schon belegt.“ */
  setShortcut(slot: Slot, accelerator: string): Promise<Result>;

  getAppInfo(): Promise<{ version: string; autostart: boolean }>;
  setAutostart(on: boolean): Promise<Result>;

  /** Status aller Kürzel (an alle Fenster). Rückgabe = Abmelden. */
  onStatus(cb: (s: StatusEvent) => void): () => void;

  // Nur im Aufnahme-Fenster (?pill=1):
  /** Main schaltet Aufnahme an/aus. start=true → Mikro starten, false → stoppen + abgeben. */
  onRecordingToggle(cb: (e: { slot: "A" | "C"; start: boolean }) => void): () => void;
  submitRecording(slot: "A" | "C", audio: ArrayBuffer, mimeType: string): Promise<Result>;
}

declare global {
  interface Window {
    flowbase: FlowbaseBridge;
  }
}
