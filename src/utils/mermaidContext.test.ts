import { describe, expect, it } from "vitest";
import {
  clearMermaidExternalContext,
  extractMermaidExternalContext,
  setMermaidExternalContext,
} from "./mermaidContext";

describe("mermaid external context block", () => {
  it("inserts external context above objectives", () => {
    const code = `%% OBJECTIVES: Build a checkout flow
flowchart TD
    A[Start] --> B[Pay]`;

    expect(setMermaidExternalContext(code, "Project: Commerce refresh")).toBe(`%% EXTERNAL CONTEXT:
%% Project: Commerce refresh
%% END EXTERNAL CONTEXT
%% OBJECTIVES: Build a checkout flow
flowchart TD
    A[Start] --> B[Pay]`);
  });

  it("inserts external context above the diagram when objectives are absent", () => {
    const code = `flowchart TD
    A[Start] --> B[Next]`;

    expect(setMermaidExternalContext(code, "Folder summary")).toBe(`%% EXTERNAL CONTEXT:
%% Folder summary
%% END EXTERNAL CONTEXT
flowchart TD
    A[Start] --> B[Next]`);
  });

  it("updates an existing block without duplicating it", () => {
    const code = `%% EXTERNAL CONTEXT:
%% Old context
%% END EXTERNAL CONTEXT
%% OBJECTIVES: Keep the canvas focused
flowchart TD
    A --> B`;

    const updated = setMermaidExternalContext(code, "New context");

    expect(updated.match(/EXTERNAL CONTEXT/g)).toHaveLength(2);
    expect(updated).toContain("%% New context");
    expect(updated).not.toContain("Old context");
  });

  it("extracts multiline external context text", () => {
    const code = `%% EXTERNAL CONTEXT:
%% Folder: Client Portal
%%
%% Summary: Login and billing work
%% END EXTERNAL CONTEXT
%% OBJECTIVES: Improve account settings
flowchart TD
    A --> B`;

    expect(extractMermaidExternalContext(code)).toBe("Folder: Client Portal\n\nSummary: Login and billing work");
  });

  it("clears the block when context is empty", () => {
    const code = `%% EXTERNAL CONTEXT:
%% Folder context
%% END EXTERNAL CONTEXT
%% OBJECTIVES: Preserve this
flowchart TD
    A --> B`;

    expect(clearMermaidExternalContext(code)).toBe(`%% OBJECTIVES: Preserve this
flowchart TD
    A --> B`);
  });

  it("leaves default canvas content comparable after clearing context", () => {
    const code = `%% EXTERNAL CONTEXT:
%% Folder context
%% END EXTERNAL CONTEXT
flowchart TD
    A[Start] --> B[Next Step]`;

    expect(clearMermaidExternalContext(code).trim()).toBe("flowchart TD\n    A[Start] --> B[Next Step]");
  });
});
