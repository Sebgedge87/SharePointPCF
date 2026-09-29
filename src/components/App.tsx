import * as React from "react";
import { FluentProvider, MessageBar, MessageBarBody, MessageBarTitle, webLightTheme } from "@fluentui/react-components";
import { IInputs } from "../generated/ManifestTypes";
import { AppServices, ControlConfig } from "../services/appServices";
import { SpikePanel } from "./SpikePanel";

export interface AppProps {
    context: ComponentFramework.Context<IInputs>;
    config: ControlConfig;
    services: AppServices;
}

export const SPIKE_VIEW_NAME = "__spike__";

export const App: React.FC<AppProps> = ({ context, config, services }) => {
    const theme = (context as unknown as { fluentDesignLanguage?: { tokenTheme?: typeof webLightTheme } }).fluentDesignLanguage?.tokenTheme ?? webLightTheme;
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
        body = <div>Grid not implemented yet.</div>;
    }
    return <FluentProvider theme={theme}>{body}</FluentProvider>;
};
