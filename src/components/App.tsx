import * as React from "react";
import { FluentProvider, MessageBar, MessageBarBody, MessageBarTitle, Theme, makeStyles, tokens, webLightTheme } from "@fluentui/react-components";
import { IInputs } from "../generated/ManifestTypes";
import { AppServices, ControlConfig, currentRecord, entitySetName } from "../services/appServices";
import { GridSession, loadGridSession } from "../services/gridLoader";
import { parseColumnConfig } from "../config/columnConfig";
import { ResolvedFolder } from "../services/dataverse/folderResolver";
import { AppError, isAppError } from "../utils/errors";
import { sharePointScopeFor } from "../services/auth/hostAllowlist";
import { SpikePanel } from "./SpikePanel";
import { ErrorState, Loading, Warnings } from "./StatusViews";
import { GridView } from "./GridView";
import { toAppError } from "./useGridData";

export interface AppProps {
    context: ComponentFramework.Context<IInputs>;
    config: ControlConfig;
    services: AppServices;
}

export const SPIKE_VIEW_NAME = "__spike__";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalS,
        width: "100%",
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorNeutralForeground1,
    },
});

type LoadState = { status: "loading" } | { status: "error"; error: AppError } | { status: "ready"; session: GridSession };

export const App: React.FC<AppProps> = ({ context, config, services }) => {
    const styles = useStyles();
    const theme: Theme = (context as unknown as { fluentDesignLanguage?: { tokenTheme?: Theme } }).fluentDesignLanguage?.tokenTheme ?? webLightTheme;

    let body: React.ReactNode;
    if (services.configProblems.length) {
        body = (
            <MessageBar intent="error">
                <MessageBarBody>
                    <MessageBarTitle>Control is not configured</MessageBarTitle>
                    {services.configProblems.join(" ")}
                </MessageBarBody>
            </MessageBar>
        );
    } else if (config.viewName === SPIKE_VIEW_NAME) {
        body = <SpikePanel config={config} services={services} />;
    } else {
        body = <Loader context={context} config={config} services={services} />;
    }
    return (
        <FluentProvider theme={theme} className={styles.root}>
            {body}
        </FluentProvider>
    );
};

const Loader: React.FC<AppProps> = ({ context, config: configProp, services }) => {
    // updateView hands us a fresh config object on every host render; only reload when a value changes.
    const configKey = JSON.stringify(configProp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const config = React.useMemo(() => configProp, [configKey]);
    const record = currentRecord(context);
    const [state, setState] = React.useState<LoadState>({ status: "loading" });
    const [warnings, setWarnings] = React.useState<string[]>([]);
    const columnConfig = React.useMemo(() => parseColumnConfig(config.columnConfigJson), [config.columnConfigJson]);
    const attempt = React.useRef(0);

    const load = React.useCallback(
        async (chosen?: ResolvedFolder, candidates?: ResolvedFolder[]) => {
            if (!record) return;
            const id = ++attempt.current;
            setState({ status: "loading" });
            try {
                const session = await loadGridSession({
                    resolver: services.resolver!,
                    record,
                    settings: {
                        folderMode: config.folderMode,
                        libraryName: config.libraryName,
                        siteUrl: config.siteUrl,
                        fallbackTemplate: config.fallbackTemplate,
                        folderUrlOverride: config.folderUrlOverride,
                    },
                    viewName: config.viewName,
                    autoCreateFolder: config.autoCreateFolder,
                    columnConfig: columnConfig.config,
                    sharePoint: services.sharePoint,
                    entitySetName: () => entitySetName(context, record.entityName),
                    chosen,
                    candidates,
                });
                if (id !== attempt.current) return;
                setWarnings([...columnConfig.warnings, ...session.warnings]);
                setState({ status: "ready", session });
            } catch (e) {
                if (id === attempt.current) setState({ status: "error", error: toAppError(e) });
            }
        },
        // record id / config identify the load; context itself changes every updateView
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [record?.id, config, services, columnConfig],
    );

    React.useEffect(() => {
        void load();
    }, [load]);

    /** Sign-in from a click (popup-friendly), then reload. */
    const signIn = async () => {
        const site = config.siteUrl ?? config.folderUrlOverride;
        const scope = services.auth!.lastInteractiveScope ?? (site ? sharePointScopeFor(site) : undefined);
        if (!scope) return;
        try {
            await services.auth!.signInInteractive(scope);
            void load();
        } catch (e) {
            setState({ status: "error", error: toAppError(e) });
        }
    };

    if (!record) {
        return (
            <MessageBar intent="info">
                <MessageBarBody>Save the record to see its SharePoint documents.</MessageBarBody>
            </MessageBar>
        );
    }
    if (state.status === "loading") return <Loading label="Loading SharePoint documents…" />;
    if (state.status === "error") {
        const e = state.error;
        return <ErrorState error={e} onSignIn={signIn} onRetry={() => void load()} extra={isAppError(e, "popup-blocked") ? <PopupHelp /> : undefined} />;
    }
    return (
        <>
            <Warnings warnings={warnings} onDismiss={() => setWarnings([])} />
            <GridView
                session={state.session}
                services={services}
                onPickLocation={(f) => void load(f, state.session.candidates)}
                onAuthError={(e) => setState({ status: "error", error: e })}
            />
        </>
    );
};

const PopupHelp: React.FC = () => (
    <div>Your browser blocked the sign-in window. Allow popups for this Dynamics 365 site (address bar icon), then select Sign in.</div>
);
