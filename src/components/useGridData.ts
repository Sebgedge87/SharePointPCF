import * as React from "react";
import { GridSession } from "../services/gridLoader";
import { RenderRow } from "../services/sharepoint/items";
import { buildViewXml, FilterSpec, SortSpec } from "../services/sharepoint/viewXml";
import { AppError } from "../utils/errors";
import { redact } from "../services/auth/redact";

export interface GridData {
    rows: RenderRow[];
    loading: boolean;
    error?: AppError;
    sort?: SortSpec;
    filters: FilterSpec[];
    pageIndex: number;
    hasNext: boolean;
    hasPrev: boolean;
    setSort(sort: SortSpec | undefined): void;
    setFilters(filters: FilterSpec[]): void;
    next(): void;
    prev(): void;
    reload(): Promise<void>;
}

export function toAppError(e: unknown): AppError {
    return e instanceof AppError ? e : new AppError("http", redact(e instanceof Error ? e.message : e));
}

/**
 * Server-side paging / sort / filter over RenderListDataAsStream. Sort and
 * filter changes rebuild the ViewXml and restart at page 1. Paging uses the
 * NextHref tokens; a stack of page queries lets "previous" go back exactly.
 */
export function useGridData(session: GridSession | undefined): GridData {
    const [rows, setRows] = React.useState<RenderRow[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<AppError>();
    const [sort, setSortState] = React.useState<SortSpec>();
    const [filters, setFiltersState] = React.useState<FilterSpec[]>([]);
    // pages[i] = query for page i (undefined for the first page)
    const [pages, setPages] = React.useState<(string | undefined)[]>([undefined]);
    const [pageIndex, setPageIndex] = React.useState(0);
    const [nextQuery, setNextQuery] = React.useState<string>();
    const requestId = React.useRef(0);

    const viewXml = React.useMemo(
        () =>
            session
                ? buildViewXml({
                      viewFields: session.view.viewFields,
                      viewQuery: session.view.viewQuery,
                      rowLimit: session.view.rowLimit,
                      fields: session.fields,
                      sort,
                      filters,
                  })
                : "",
        [session, sort, filters],
    );

    const load = React.useCallback(
        async (index: number, query: string | undefined) => {
            if (!session) return;
            const id = ++requestId.current;
            setLoading(true);
            setError(undefined);
            try {
                const page = await session.items.render(viewXml, session.folder.folderServerRelativeUrl, query);
                if (id !== requestId.current) return;
                setRows(page.rows);
                setNextQuery(page.nextPage);
                setPageIndex(index);
            } catch (e) {
                if (id === requestId.current) setError(toAppError(e));
            } finally {
                if (id === requestId.current) setLoading(false);
            }
        },
        [session, viewXml],
    );

    // Restart at page 1 whenever the query shape changes.
    React.useEffect(() => {
        setPages([undefined]);
        void load(0, undefined);
    }, [load]);

    return {
        rows,
        loading,
        error,
        sort,
        filters,
        pageIndex,
        hasNext: !!nextQuery,
        hasPrev: pageIndex > 0,
        setSort: setSortState,
        setFilters: setFiltersState,
        next: () => {
            if (!nextQuery) return;
            const index = pageIndex + 1;
            setPages((p) => [...p.slice(0, index), nextQuery]);
            void load(index, nextQuery);
        },
        prev: () => {
            if (pageIndex === 0) return;
            void load(pageIndex - 1, pages[pageIndex - 1]);
        },
        reload: () => load(pageIndex, pages[pageIndex]),
    };
}
