/**
 * @jest-environment jsdom
 */
import * as React from "react";
import { act, render, screen } from "@testing-library/react";

jest.mock("../src/services/gridLoader", () => ({ loadGridSession: jest.fn() }));
import { loadGridSession } from "../src/services/gridLoader";
import { App } from "../src/components/App";
import { AppError } from "../src/utils/errors";
import { AppServices, ControlConfig } from "../src/services/appServices";

// jsdom has no ResizeObserver (Fluent MessageBar reflow uses it)
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
};

const load = loadGridSession as jest.MockedFunction<typeof loadGridSession>;

const context = {
    mode: { contextInfo: { entityId: "aaaaaaaa-1111-2222-3333-444444444444", entityTypeName: "contact" } },
    userSettings: { userName: "jane@contoso.com" },
} as never;

const config = (): ControlConfig => ({
    clientId: "c",
    tenantId: "t",
    viewName: "Grid",
    folderMode: "documentLocation",
    autoCreateFolder: false,
});

const services = { configProblems: [], resolver: {}, sharePoint: jest.fn(), auth: { signInInteractive: jest.fn() } } as unknown as AppServices;

describe("App loader", () => {
    it("loads once across host re-renders with an equal config, and shows folder-not-found", async () => {
        load.mockRejectedValue(new AppError("folder-not-found", "No SharePoint folder was found for this record."));
        const { rerender } = render(<App context={context} config={config()} services={services} />);
        await act(async () => undefined);
        rerender(<App context={context} config={config()} services={services} />);
        rerender(<App context={context} config={config()} services={services} />);
        await act(async () => undefined);
        expect(load).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Folder not found")).toBeTruthy();

        rerender(<App context={context} config={{ ...config(), viewName: "Other" }} services={services} />);
        await act(async () => undefined);
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("asks to save a new record first", () => {
        const newCtx = { userSettings: { userName: "jane@contoso.com" }, mode: { contextInfo: { entityId: "", entityTypeName: "contact" } } } as never;
        render(<App context={newCtx} config={config()} services={services} />);
        expect(screen.getByText(/Save the record/)).toBeTruthy();
    });

    it("shows configuration problems", () => {
        render(<App context={context} config={config()} services={{ ...services, configProblems: ["clientId must be a GUID."] }} />);
        expect(screen.getByText("clientId must be a GUID.")).toBeTruthy();
    });
});
