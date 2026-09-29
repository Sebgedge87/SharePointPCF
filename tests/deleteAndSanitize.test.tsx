/**
 * @jest-environment jsdom
 */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ItemService } from "../src/services/sharepoint/items";
import { DisplayCell, sanitizeHtml } from "../src/components/DisplayCell";
import { ErrorState } from "../src/components/StatusViews";
import { AppError } from "../src/utils/errors";
import { fakeFetch, on } from "./helpers/fakeFetch";
import { SITE, spFactory } from "./helpers/spFixture";

describe("delete", () => {
    it("recycles the item (recoverable), never a hard delete", async () => {
        const f = fakeFetch(on("POST", "/items(9)/recycle()", () => ({ value: "guid" })));
        const items = new ItemService(spFactory(f.fetch)(SITE), { id: "L", title: "c", rootFolderServerRelativeUrl: "/x", enableVersioning: true, forceCheckout: false });
        await items.recycle(9);
        expect(f.calls).toHaveLength(1);
        expect(f.calls[0].url).toBe(`${SITE}/_api/web/lists(guid'L')/items(9)/recycle()`);
        expect(f.calls[0].method).toBe("POST");
    });
});

describe("rich text sanitising", () => {
    it("strips scripts, handlers and javascript: links", () => {
        const out = sanitizeHtml(`<p onclick="x()">Hi<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">l</a><style>*{}</style><iframe src="https://evil"></iframe></p>`);
        expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe|style/i);
        expect(out).toContain("Hi");
    });

    it("renders sanitised HTML and only safe links", () => {
        render(
            <FluentProvider theme={webLightTheme}>
                <DisplayCell value={{ kind: "html", html: `<b>bold</b><img src=x onerror="alert(1)">` }} />
                <DisplayCell value={{ kind: "link", href: "javascript:alert(1)", text: "bad" }} />
                <DisplayCell value={{ kind: "link", href: "https://ok.example", text: "good" }} />
            </FluentProvider>,
        );
        expect(screen.getByText("bold").tagName).toBe("B");
        expect(document.querySelector("[onerror]")).toBeNull();
        expect(screen.getByText("bad").closest("a")).toBeNull();
        expect(screen.getByText("good").closest("a")?.getAttribute("href")).toBe("https://ok.example");
    });
});

describe("error states", () => {
    it.each([
        ["popup-blocked", "Sign-in popup was blocked", true],
        ["auth-required", "Sign in to SharePoint", true],
        ["folder-not-found", "Folder not found", false],
        ["no-permission", "No permission", false],
        ["throttled", "SharePoint is busy", false],
    ] as const)("%s shows a distinct state", (kind, title, signIn) => {
        render(
            <FluentProvider theme={webLightTheme}>
                <ErrorState error={new AppError(kind, "details")} onSignIn={() => undefined} onRetry={() => undefined} />
            </FluentProvider>,
        );
        expect(screen.getByText(title)).toBeTruthy();
        expect(!!screen.queryByRole("button", { name: "Sign in" })).toBe(signIn);
        expect(!!screen.queryByRole("button", { name: "Retry" })).toBe(!signIn);
    });
});
