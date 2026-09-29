import * as React from "react";
import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { App } from "./components/App";
import { AppServices, createServices, readControlConfig } from "./services/appServices";

export class SharePointMetadataGrid implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private services?: AppServices;
    private servicesKey?: string;

    public init(context: ComponentFramework.Context<IInputs>): void {
        context.mode.trackContainerResize(true);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const config = readControlConfig(context);
        // One MSAL instance per control, created once (re-created only if the app registration changes).
        const key = `${config.clientId}|${config.tenantId}`;
        if (!this.services || this.servicesKey !== key) {
            this.services = createServices(context, config);
            this.servicesKey = key;
        }
        return React.createElement(App, { context, config, services: this.services });
    }

    public getOutputs(): IOutputs {
        return {};
    }

    public destroy(): void {
        this.services = undefined;
    }
}
