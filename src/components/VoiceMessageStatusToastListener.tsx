import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./ui/useToast";
import { isDictationPanelWindow } from "../utils/windowContext";

/**
 * Shows the progress of the Flowbase shortcuts as toasts: B (text → voice message),
 * C (speech → voice message) and A (dictation via Flowbase, "idle" just closes the
 * working toast because the inserted text is the feedback).
 */
export default function VoiceMessageStatusToastListener() {
  const { t } = useTranslation();
  const { toast, dismiss } = useToast();
  const workingToastId = useRef<string | null>(null);

  useEffect(() => {
    // Only the dictation panel toasts: it always exists, so a broadcast never shows twice.
    if (!isDictationPanelWindow()) return;
    const unsubscribe = window.electronAPI?.onFlowbaseVoiceMessageStatus?.(
      ({ state, message, title }) => {
        if (workingToastId.current) {
          dismiss(workingToastId.current);
          workingToastId.current = null;
        }
        if (state === "idle") return;
        window.electronAPI?.showDictationPanel?.();
        if (state === "working") {
          workingToastId.current = toast({
            title: message || t("app.toasts.voiceMessage.working"),
          });
        } else if (state === "done") {
          toast({ title: message || t("app.toasts.voiceMessage.done"), variant: "success" });
        } else {
          toast({
            title: title || t("app.toasts.voiceMessage.errorTitle"),
            description: message,
            variant: "destructive",
            duration: 10000,
          });
        }
      }
    );
    return () => unsubscribe?.();
  }, [toast, dismiss, t]);

  return null;
}
