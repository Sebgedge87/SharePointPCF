import * as React from "react";
import DOMPurify from "dompurify";
import { Link, Text, Tooltip } from "@fluentui/react-components";
import { DisplayValue } from "../model/display";

/** Rich text from SharePoint is sanitised before it touches the DOM. */
export function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed", "svg", "math"],
        FORBID_ATTR: ["style"],
    });
}

const SAFE_LINK = /^(https?:|mailto:)/i;

export const DisplayCell: React.FC<{ value: DisplayValue }> = ({ value }) => {
    switch (value.kind) {
        case "html":
            return <div className="spmg-rich" dangerouslySetInnerHTML={{ __html: sanitizeHtml(value.html) }} />;
        case "link":
            return SAFE_LINK.test(value.href) ? (
                <Link href={value.href} target="_blank" rel="noopener noreferrer">
                    {value.text}
                </Link>
            ) : (
                <Text>{value.text}</Text>
            );
        default:
            return value.text.length > 60 ? (
                <Tooltip content={value.text} relationship="description">
                    <Text truncate wrap={false}>
                        {value.text}
                    </Text>
                </Tooltip>
            ) : (
                <Text>{value.text}</Text>
            );
    }
};
