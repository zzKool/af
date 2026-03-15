import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";

type TestRow = { id: string; name: string; value: number };

const columns: ColumnDef<TestRow>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    enableSorting: true,
    cell: ({ row }) => <span>{row.original.name}</span>,
  },
  {
    id: "value",
    accessorKey: "value",
    header: "Value",
    enableSorting: true,
    cell: ({ row }) => <span>{row.original.value}</span>,
  },
];

const sampleData: TestRow[] = [
  { id: "1", name: "Alice", value: 100 },
  { id: "2", name: "Bob", value: 200 },
  { id: "3", name: "Charlie", value: 300 },
];

const defaultProps = {
  columns,
  data: sampleData,
  totalCount: 3,
  page: 1,
  pageSize: 25,
  sorting: [] as SortingState,
  onSortingChange: vi.fn(),
  onPageChange: vi.fn(),
};

describe("DataTable", () => {
  it("renders column headers", () => {
    render(<DataTable {...defaultProps} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("renders data rows", () => {
    render(<DataTable {...defaultProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("clicking a sortable column header fires onSortingChange", () => {
    const onSortingChange = vi.fn();
    render(<DataTable {...defaultProps} onSortingChange={onSortingChange} />);
    fireEvent.click(screen.getByText("Name"));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "name", desc: false }]);
  });

  it("clicking sorted column again toggles to desc", () => {
    const onSortingChange = vi.fn();
    render(
      <DataTable
        {...defaultProps}
        sorting={[{ id: "name", desc: false }]}
        onSortingChange={onSortingChange}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "name", desc: true }]);
  });

  it("renders pagination controls", () => {
    render(<DataTable {...defaultProps} totalCount={100} pageSize={25} />);
    expect(screen.getByText(/Page 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("pagination Previous is disabled on page 1", () => {
    render(<DataTable {...defaultProps} page={1} totalCount={100} />);
    expect(screen.getByText("Previous")).toBeDisabled();
  });

  it("pagination Next fires onPageChange", () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        {...defaultProps}
        page={1}
        totalCount={100}
        pageSize={25}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.click(screen.getByText("Next"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders empty state when data is empty", () => {
    render(
      <DataTable
        {...defaultProps}
        data={[]}
        totalCount={0}
        emptyState={<div>Custom empty state</div>}
      />,
    );
    expect(screen.getByText("Custom empty state")).toBeInTheDocument();
  });

  it("renders loading skeleton rows when isLoading=true", () => {
    const { container } = render(
      <DataTable {...defaultProps} isLoading={true} data={[]} totalCount={0} />,
    );
    // Skeleton rows rendered
    const skeletons = container.querySelectorAll('[class*="skeleton"], [data-slot]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("fires onRowClick when row is clicked", () => {
    const onRowClick = vi.fn();
    render(<DataTable {...defaultProps} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onRowClick).toHaveBeenCalledWith(sampleData[0]);
  });
});
