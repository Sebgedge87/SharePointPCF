import * as React from "react";
import { GridSession } from "../services/gridLoader";
import { AppServices } from "../services/appServices";
import { ResolvedFolder } from "../services/dataverse/folderResolver";
import { AppError } from "../utils/errors";
import { RenderRow } from "../services/sharepoint/items";
import { GridToolbar } from "./GridToolbar";
import { MetadataGrid, RowActions, fileUrl } from "./MetadataGrid";
import { useGridData } from "./useGridData";

export interface GridViewProps {
    session: GridSession;
    services: AppServices;
    onPickLocation(folder: ResolvedFolder): void;
    onAuthError(e: AppError): void;
}

const AUTH_KINDS = new Set(["auth-required", "popup-blocked", "auth-cancelled", "auth-failed"]);

export const GridView: React.FC<GridViewProps> = ({ session, onPickLocation, onAuthError }) => {
    const data = useGridData(session);

    React.useEffect(() => {
        if (data.error && AUTH_KINDS.has(data.error.kind)) onAuthError(data.error);
    }, [data.error, onAuthError]);

    const actions: RowActions = React.useMemo(
        () => ({
            onOpen: (row: RenderRow) => window.open(fileUrl(session, row), "_blank", "noopener,noreferrer"),
        }),
        [session],
    );

    return (
        <>
            <GridToolbar
                columns={session.columns}
                filters={data.filters}
                onFilters={data.setFilters}
                onRefresh={() => void data.reload()}
                candidates={session.candidates}
                current={session.folder}
                onPickLocation={onPickLocation}
                busy={data.loading}
            />
            <MetadataGrid session={session} data={data} actions={actions} />
        </>
    );
};
