import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(() => {
  cleanup();
});

describe("ConfirmDialog", () => {
  it("portals onto document.body and focuses Cancel", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    render(
      <ConfirmDialog
        title="Delete this 3x3?"
        body="Gone for good."
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
      { container: root },
    );
    const dialog = screen.getByRole("alertdialog");
    expect(document.body.contains(dialog)).toBe(true);
    expect(root.contains(dialog)).toBe(false);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    root.remove();
  });

  it("fires onConfirm from the danger button", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Delete this 3x3?"
        body="Gone for good."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("cancels from Cancel, the backdrop, and Escape without confirming", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Remove this tile?"
        body="You can add it again later."
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(screen.getByRole("alertdialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
