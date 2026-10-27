"use client";

import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import Link from "next/link";
import { Fragment } from "react";
import { StageBadge, VerdictBadge } from "@/components/badges";
import { Fact, Facts } from "@/components/facts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { basescanTx, shortHex, shortId } from "@/lib/format";
import type { Stage } from "@/lib/trace";
import type { DecisionRow } from "@/lib/views";

const columns: ColumnDef<DecisionRow>[] = [
  {
    id: "expand",
    header: "",
    cell: ({ row }) => (
      <button
        type="button"
        onClick={row.getToggleExpandedHandler()}
        aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
        className="text-muted-foreground hover:text-foreground"
      >
        {row.getIsExpanded() ? "▾" : "▸"}
      </button>
    ),
  },
  {
    accessorKey: "issuedAt",
    header: "Issued (UTC)",
    cell: ({ getValue }) => (
      <span className="font-mono text-xs whitespace-nowrap">
        {getValue<string>().replace("T", " ").slice(0, 19)}
      </span>
    ),
  },
  {
    accessorKey: "agent",
    header: "Agent",
    cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
  },
  {
    accessorKey: "amount",
    header: () => <span className="block text-right">Amount</span>,
    cell: ({ getValue }) => (
      <span className="block text-right tabular-nums">${getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "verdict",
    header: "Verdict",
    cell: ({ getValue }) => <VerdictBadge verdict={getValue<string>()} />,
  },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ getValue }) => (
      <span className="line-clamp-1 max-w-72 text-muted-foreground">{getValue<string>()}</span>
    ),
  },
  {
    accessorKey: "stage",
    header: "Payment",
    cell: ({ getValue }) => <StageBadge stage={getValue<Stage>()} />,
  },
];

export function DecisionsTable({ rows }: { rows: DecisionRow[] }) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8 predates the React Compiler.
  const table = useReactTable({
    data: rows,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">No decisions match.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id}>
                {flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <Fragment key={row.id}>
            <TableRow className="hover:bg-muted/50">
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
            {row.getIsExpanded() && (
              <TableRow className="bg-muted/40">
                <TableCell colSpan={columns.length}>
                  <Expanded row={row.original} />
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function Expanded({ row }: { row: DecisionRow }) {
  return (
    <div className="grid gap-6 py-2 md:grid-cols-[1fr_1.4fr]">
      <Facts className="grid-cols-[7rem_1fr] gap-y-1.5 text-xs">
        <Fact label="Decision">
          <Link href={`/decisions/${row.id}`} className="font-mono underline underline-offset-2">
            {row.id}
          </Link>
        </Fact>
        <Fact label="Reason">{row.reason}</Fact>
        <Fact label="Mandate">
          {row.mandate ? <span className="font-mono">{shortId(row.mandate)}</span> : "none"}
        </Fact>
        <Fact label="Category">{row.category}</Fact>
        <Fact label="Recipient">
          <span className="font-mono">{row.recipient}</span>
        </Fact>
        <Fact label="Mode">{row.mode}</Fact>
        <Fact label="Transaction">
          {row.txHash ? (
            <a
              href={basescanTx(row.txHash)}
              target="_blank"
              rel="noreferrer"
              className="font-mono underline underline-offset-2"
            >
              {shortHex(row.txHash)} on Basescan ↗
            </a>
          ) : (
            "none"
          )}
        </Fact>
        <dd className="col-span-2 pt-2">
          <Link
            href={`/decisions/${row.id}`}
            className="text-xs font-medium underline underline-offset-2"
          >
            Full payment trace →
          </Link>
        </dd>
      </Facts>
      <div className="grid gap-2">
        <p className="text-xs font-medium">Verdict token (decoded)</p>
        <pre className="max-h-64 overflow-auto rounded-md border bg-card p-3 font-mono text-[11px] leading-relaxed">
          {row.token.header}
          {"\n"}
          {row.token.payload}
        </pre>
      </div>
    </div>
  );
}
