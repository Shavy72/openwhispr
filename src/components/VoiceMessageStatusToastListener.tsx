import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./ui/useToast";
import { isDictationPanelWindow } from "../utils/windowContext";

/** Shows the progress of shortcut B (text → Flowbase voice message) as toasts. */
export default function VoiceMessageStatusToastListener() {
  const { t } = useTranslation();
  const { toast, dismiss } = useToast();
  const workingToastId = useRef<string | null>(null);

  useEffect(() => {
    // Only the dictation panel toasts: it always exists, so a broadcast never shows twice.
    if (!isDictationPanelWindow()) return;
    const unsubscribe = window.electronAPI?.onFlowbaseVoiceMessageStatus?.(({ state, message }) => {
      window.electronAPI?.showDictationPanel?.();
      if (workingToastId.current) {
        dismiss(workingToastId.current);
        workingToastId.current = null;
      }
      if (state === "working") {
        workingToastId.current = toast({
          title: message || t("app.toasts.voiceMessage.working"),
        });
      } else if (state === "done") {
        toast({ title: t("app.toasts.voiceMessage.done"), variant: "success" });
      } else {
        toast({
          title: t("app.toasts.voiceMessage.errorTitle"),
          description: message,
          variant: "destructive",
          duration: 10000,
        });
      }
    });
    return () => unsubscribe?.();
  }, [toast, dismiss, t]);

  return null;
}
