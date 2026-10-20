import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import OptionCard from "../ui/OptionCard";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { AudioLines, LogOut } from "../icons";

type FlowbaseUser = { name: string; email: string; role: string };
type FlowbaseModel = { id: string; name: string };

interface FlowbaseAccountSectionProps {
  /** Wird nach erfolgreichem Login bzw. Logout gerufen (z. B. Onboarding geht weiter). */
  onSessionChange?: (loggedIn: boolean) => void;
}

/**
 * Flowbase-Konto: Login mit Flowbase-Zugangsdaten, danach Liste der zugewiesenen Models.
 * Alle HTTP-Calls laufen im Main-Prozess (window.electronAPI.flowbase*); hier nur Anzeige.
 */
export default function FlowbaseAccountSection({ onSessionChange }: FlowbaseAccountSectionProps) {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState<FlowbaseUser | null>(null);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [models, setModels] = useState<FlowbaseModel[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setModelsError(null);
    const result = await window.electronAPI.flowbaseListModels();
    if (result.ok) {
      setModels(result.models);
    } else {
      setModels([]);
      setModelsError(result.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await window.electronAPI.flowbaseGetSession();
      if (cancelled) return;
      setUser(session.loggedIn && session.user ? session.user : null);
      setActiveModelId(session.activeModelId ?? null);
      setLoaded(true);
      if (session.loggedIn) await loadModels();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadModels]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.flowbaseLogin(email.trim(), password);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setUser(result.user);
      setPassword("");
      const session = await window.electronAPI.flowbaseGetSession();
      setActiveModelId(session.activeModelId ?? null);
      await loadModels();
      onSessionChange?.(true);
    } catch {
      setError(t("flowbaseAccount.errors.unexpected"));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await window.electronAPI.flowbaseLogout();
      setUser(null);
      setModels(null);
      setActiveModelId(null);
      onSessionChange?.(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    const previous = activeModelId;
    setActiveModelId(modelId);
    const result = await window.electronAPI.flowbaseSetActiveModel(modelId);
    if (!result.ok) setActiveModelId(previous);
  };

  if (!loaded) return null;

  if (!user) {
    return (
      <div className="space-y-5">
        <SectionHeader
          title={t("flowbaseAccount.title")}
          description={t("flowbaseAccount.loginDescription")}
        />
        <SettingsPanel>
          <SettingsPanelRow>
            <form className="space-y-3" onSubmit={handleLogin}>
              <div className="space-y-1.5">
                <Label htmlFor="flowbase-email" className="text-xs">
                  {t("flowbaseAccount.email")}
                </Label>
                <Input
                  id="flowbase-email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="flowbase-password" className="text-xs">
                  {t("flowbaseAccount.password")}
                </Label>
                <Input
                  id="flowbase-password"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" size="sm" className="w-full" disabled={busy}>
                {busy ? t("flowbaseAccount.signingIn") : t("flowbaseAccount.signIn")}
              </Button>
            </form>
          </SettingsPanelRow>
        </SettingsPanel>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader title={t("flowbaseAccount.title")} />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow label={user.name || user.email} description={user.email}>
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              disabled={busy}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50"
            >
              <LogOut className="me-1.5 h-3.5 w-3.5" />
              {t("flowbaseAccount.signOut")}
            </Button>
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      <div>
        <SectionHeader
          title={t("flowbaseAccount.models.title")}
          description={
            models && models.length > 0 && !activeModelId
              ? t("flowbaseAccount.models.noneActive")
              : undefined
          }
        />
        {models === null ? null : modelsError ? (
          <p role="alert" className="text-xs text-destructive">
            {modelsError}
          </p>
        ) : models.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("flowbaseAccount.models.empty")}</p>
        ) : (
          <div className="grid gap-2">
            {models.map((model) => {
              const selected = model.id === activeModelId;
              return (
                <OptionCard
                  key={model.id}
                  icon={AudioLines}
                  title={model.name}
                  description={
                    selected
                      ? t("flowbaseAccount.models.active")
                      : t("flowbaseAccount.models.select")
                  }
                  selected={selected}
                  onSelect={() => void handleSelectModel(model.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
