import { IInputs } from "../generated/ManifestTypes";
import { AuthService, validateAuthSettings } from "./auth/authService";
import { HttpClient } from "./httpClient";
import { scopeForUrl } from "./auth/scopes";
import { SharePointRest } from "./sharepoint/spRest";
import { AbsoluteUrlFn, DataverseApi, FolderResolver, RecordRef } from "./dataverse/folderResolver";

export type FolderMode = "documentLocation" | "template" | "override";

/** Everything read from the manifest inputs, normalised. None of it is secret. */
export interface ControlConfig {
    clientId: string;
    tenantId: string;
    viewName: string;
    libraryName?: string;
    siteUrl?: string;
    folderMode: FolderMode;
    fallbackTemplate?: string;
    autoCreateFolder: boolean;
    folderUrlOverride?: string;
    columnConfigJson?: string;
}

const text = (p?: ComponentFramework.PropertyTypes.StringProperty | null): string | undefined => {
    const v = p?.raw?.trim();
    return v ? v : undefined;
};

export function readControlConfig(context: ComponentFramework.Context<IInputs>): ControlConfig {
    const p = context.parameters;
    const mode = p.folderMode?.raw;
    return {
        clientId: text(p.clientId) ?? "",
        tenantId: text(p.tenantId) ?? "",
        viewName: text(p.viewName) ?? "",
        libraryName: text(p.libraryName),
        siteUrl: text(p.siteUrl),
        folderMode: mode === "template" || mode === "override" ? mode : "documentLocation",
        fallbackTemplate: text(p.fallbackTemplate),
        autoCreateFolder: p.autoCreateFolder?.raw === true,
        folderUrlOverride: text(p.folderUrlOverride),
        columnConfigJson: text(p.columnConfig),
    };
}

export function validateControlConfig(c: ControlConfig): string[] {
    const problems = validateAuthSettings(c);
    if (!c.viewName) problems.push("viewName is required.");
    return problems;
}

export interface AppServices {
    auth?: AuthService;
    resolver?: FolderResolver;
    http?: HttpClient;
    /** SharePoint REST client for a web URL (validated against the host allowlist). */
    sharePoint(webUrl: string): SharePointRest;
    configProblems: string[];
}

/** Redirect URI = the D365 org URL (the SPA platform redirect registered on the app). */
export function orgRedirectUri(context: ComponentFramework.Context<IInputs>): string {
    const fromPage = (context as unknown as { page?: { getClientUrl?: () => string } }).page?.getClientUrl?.();
    return (fromPage || window.location.origin).replace(/\/+$/, "");
}

const UPN_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * loginHint for ssoSilent. userSettings.userName is usually the display name in
 * model-driven apps, so fall back to systemuser.domainname (the UPN).
 */
export async function resolveLoginHint(context: ComponentFramework.Context<IInputs>): Promise<string | undefined> {
    const name = context.userSettings.userName?.trim();
    if (name && UPN_RE.test(name)) return name;
    const userId = context.userSettings.userId?.replace(/[{}]/g, "");
    if (!userId) return undefined;
    try {
        const user = await context.webAPI.retrieveRecord("systemuser", userId, "?$select=domainname");
        const upn = (user?.domainname as string | undefined)?.trim();
        return upn && UPN_RE.test(upn) ? upn : undefined;
    } catch {
        return undefined;
    }
}

export function createServices(context: ComponentFramework.Context<IInputs>, config: ControlConfig): AppServices {
    const configProblems = validateControlConfig(config);
    if (configProblems.length) {
        return {
            configProblems,
            sharePoint: () => {
                throw new Error("Control is not configured.");
            },
        };
    }
    const auth = AuthService.create({
        clientId: config.clientId,
        tenantId: config.tenantId,
        redirectUri: orgRedirectUri(context),
        loginHint: () => resolveLoginHint(context),
    });
    const http = new HttpClient({ tokenProvider: auth.tokenProvider, scopeFor: scopeForUrl });
    const resolver = new FolderResolver(context.webAPI as unknown as DataverseApi, retrieveAbsoluteUrl(orgRedirectUri(context)));
    return {
        auth,
        http,
        resolver,
        configProblems,
        sharePoint: (webUrl: string) => new SharePointRest(http, webUrl),
    };
}

/** The record the form is showing. Undefined on a create form (not saved yet). */
export function currentRecord(context: ComponentFramework.Context<IInputs>): RecordRef | undefined {
    const info = (context.mode as unknown as { contextInfo?: { entityId?: string; entityTypeName?: string } }).contextInfo;
    const id = info?.entityId?.replace(/[{}]/g, "");
    if (!id || !info?.entityTypeName || /^0{8}-/.test(id)) return undefined;
    return { entityName: info.entityTypeName, id };
}

export async function entitySetName(context: ComponentFramework.Context<IInputs>, entityName: string): Promise<string> {
    const md = await context.utils.getEntityMetadata(entityName);
    return (md as unknown as { EntitySetName: string }).EntitySetName;
}

/**
 * RetrieveAbsoluteAndSiteCollectionUrl shortcut: a same-origin Dataverse call
 * (session cookie; no SharePoint token involved).
 */
export function retrieveAbsoluteUrl(orgUrl: string): AbsoluteUrlFn {
    return async (locationId) => {
        const id = locationId.replace(/[{}]/g, "");
        const res = await fetch(
            `${orgUrl}/api/data/v9.2/sharepointdocumentlocations(${id})/Microsoft.Dynamics.CRM.RetrieveAbsoluteAndSiteCollectionUrl()`,
            { credentials: "same-origin", headers: { Accept: "application/json", "OData-Version": "4.0", "OData-MaxVersion": "4.0" } },
        );
        if (!res.ok) return undefined;
        const body = (await res.json()) as { AbsoluteUrl?: string; SiteCollectionUrl?: string };
        return body.AbsoluteUrl ? { absoluteUrl: body.AbsoluteUrl, siteCollectionUrl: body.SiteCollectionUrl ?? "" } : undefined;
    };
}
