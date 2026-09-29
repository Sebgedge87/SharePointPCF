import * as React from "react";
import { Button, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { SpikeStep, runSharePointSpike } from "../services/sharepoint/spike";
import { AppServices, ControlConfig } from "../services/appServices";
import { sharePointScopeFor } from "../services/auth/hostAllowlist";
import { redact } from "../services/auth/redact";

const useStyles = makeStyles({
    root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalM },
    ok: { color: tokens.colorPaletteGreenForeground1 },
    bad: { color: tokens.colorPaletteRedForeground1 },
});

/** Diagnostics for Phase 1: viewName = "__spike__", siteUrl + libraryName set. */
export const SpikePanel: React.FC<{ config: ControlConfig; services: AppServices }> = ({ config, services }) => {
    const styles = useStyles();
    const [steps, setSteps] = React.useState<SpikeStep[] | undefined>();
    const [busy, setBusy] = React.useState(false);

    const run = async (write: boolean) => {
        setBusy(true);
        try {
            if (!config.siteUrl) throw new Error("Set siteUrl for the spike.");
            // user gesture: interactive sign-in allowed here
            await services.auth!.signInInteractive(sharePointScopeFor(config.siteUrl)).catch(() => undefined);
            setSteps(await runSharePointSpike(services.sharePoint(config.siteUrl), { libraryTitle: config.libraryName, write }));
        } catch (e) {
            setSteps([{ name: "setup", ok: false, detail: redact(e instanceof Error ? e.message : e) }]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={styles.root}>
            <Text weight="semibold">SharePoint delegated token spike</Text>
            <Text size={200}>Site: {config.siteUrl ?? "(set siteUrl)"}; library: {config.libraryName ?? "(set libraryName)"}</Text>
            <div style={{ display: "flex", gap: 8 }}>
                <Button disabled={busy} onClick={() => run(false)}>Run read checks</Button>
                <Button disabled={busy} appearance="primary" onClick={() => run(true)}>Run read + write checks</Button>
                {busy && <Spinner size="tiny" />}
            </div>
            {steps?.map((s, i) => (
                <Text key={i} className={s.ok ? styles.ok : styles.bad}>
                    {s.ok ? "PASS" : "FAIL"}: {s.name}: {s.detail}
                </Text>
            ))}
        </div>
    );
};
