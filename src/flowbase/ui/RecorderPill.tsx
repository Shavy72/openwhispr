import { useEffect, useRef, useState } from "react";
import type { StatusEvent } from "../bridge";

type RecSlot = "A" | "C";
type View = { slot: RecSlot; phase: StatusEvent["phase"]; message: string } | null;

const RECORDING_TEXT: Record<RecSlot, string> = {
  A: "Diktat läuft …",
  C: "Sprachnachricht läuft …",
};
const FALLBACK: Record<StatusEvent["phase"], string> = {
  recording: "Aufnahme läuft …",
  working: "Wird verarbeitet …",
  done: "Fertig",
  error: "Fehler",
};

function pickMimeType(): string {
  const preferred = "audio/webm;codecs=opus";
  return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(preferred)
    ? preferred
    : "audio/webm";
}

export default function RecorderPill() {
  const [view, setView] = useState<View>(null);
  const slotRef = useRef<RecSlot | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const startingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    document.body.classList.add("fb-pill");
    const fb = window.flowbase;

    const submit = async (slot: RecSlot, buf: ArrayBuffer, mimeType: string) => {
      try {
        const r = await fb.submitRecording(slot, buf, mimeType);
        if (!r.ok) setView({ slot, phase: "error", message: r.error });
      } catch (err) {
        setView({
          slot,
          phase: "error",
          message: err instanceof Error ? err.message : "Aufnahme konnte nicht abgegeben werden.",
        });
      }
    };

    const stop = () => {
      const rec = recorderRef.current;
      if (!rec) {
        // Stopp kam, während getUserMedia noch lief → nach dem Start sofort stoppen.
        if (startingRef.current) stopRequestedRef.current = true;
        return;
      }
      if (rec.state !== "inactive") rec.stop();
    };

    const start = async (slot: RecSlot) => {
      if (recorderRef.current || startingRef.current) return;
      slotRef.current = slot;
      startingRef.current = true;
      stopRequestedRef.current = false;
      setView({ slot, phase: "recording", message: RECORDING_TEXT[slot] });
      // Leerer Buffer: Main erkennt den Fehler und meldet ihn per onStatus.
      const fail = async (message: string, mimeType: string) => {
        startingRef.current = false;
        recorderRef.current = null;
        setView({ slot, phase: "error", message });
        await submit(slot, new ArrayBuffer(0), mimeType);
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        await fail("Mikrofon nicht verfügbar.", "");
        return;
      }
      const mimeType = pickMimeType();
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream, { mimeType });
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        await fail("Aufnahme konnte nicht starten.", mimeType);
        return;
      }
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recorderRef.current = null;
        setView({ slot, phase: "working", message: FALLBACK.working });
        const blob = new Blob(chunks, { type: rec.mimeType || mimeType });
        await submit(slot, await blob.arrayBuffer(), blob.type);
      };
      recorderRef.current = rec;
      startingRef.current = false;
      try {
        rec.start();
      } catch {
        rec.onstop = null;
        stream.getTracks().forEach((t) => t.stop());
        await fail("Aufnahme konnte nicht starten.", mimeType);
        return;
      }
      if (stopRequestedRef.current) stop();
    };

    const offToggle = fb.onRecordingToggle(({ slot, start: on }) => {
      if (on) void start(slot);
      else stop();
    });
    const offStatus = fb.onStatus((s) => {
      if (s.slot !== "A" && s.slot !== "C") return;
      if (slotRef.current && s.slot !== slotRef.current) return;
      const slot = s.slot;
      setView({
        slot,
        phase: s.phase,
        message: s.phase === "recording" ? RECORDING_TEXT[slot] : s.message || FALLBACK[s.phase],
      });
    });
    return () => {
      offToggle();
      offStatus();
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
    };
  }, []);

  if (!view) return null;
  return (
    <div className="fb-pill-wrap">
      <div className={`fb-pill fb-phase-${view.phase}`} role="status" aria-live="polite">
        <span className="fb-dot" aria-hidden="true" />
        <span className="fb-pill-text">{view.message}</span>
      </div>
    </div>
  );
}
