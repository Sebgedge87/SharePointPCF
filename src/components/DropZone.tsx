import * as React from "react";
import { Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
    root: { position: "relative" },
    overlay: {
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tokens.colorNeutralBackgroundAlpha2,
        outline: `2px dashed ${tokens.colorBrandStroke1}`,
        outlineOffset: "-4px",
        zIndex: 1,
        pointerEvents: "none",
    },
    disabled: { opacity: 0.6 },
});

export interface DropZoneProps {
    onFiles(files: File[]): void;
    disabled?: boolean;
    children: React.ReactNode;
}

/** Drag files onto the grid to upload. Folders are ignored (files only). */
export const DropZone: React.FC<DropZoneProps> = ({ onFiles, disabled, children }) => {
    const styles = useStyles();
    const [over, setOver] = React.useState(false);
    const depth = React.useRef(0);
    const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

    return (
        <div
            className={mergeClasses(styles.root, disabled && over && styles.disabled)}
            onDragEnter={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth.current++;
                setOver(true);
            }}
            onDragOver={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = disabled ? "none" : "copy";
            }}
            onDragLeave={() => {
                depth.current = Math.max(0, depth.current - 1);
                if (depth.current === 0) setOver(false);
            }}
            onDrop={(e) => {
                if (!hasFiles(e)) return;
                e.preventDefault();
                depth.current = 0;
                setOver(false);
                if (disabled) return;
                const files = Array.from(e.dataTransfer.files).filter((f) => f.size > 0 || f.type !== "");
                if (files.length) onFiles(files);
            }}
        >
            {children}
            {over && (
                <div className={styles.overlay}>
                    <Text weight="semibold">{disabled ? "Save or discard your changes before uploading" : "Drop files to upload"}</Text>
                </div>
            )}
        </div>
    );
};
