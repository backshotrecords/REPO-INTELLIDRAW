import os

file_path = r"c:\Users\xx876\Downloads\REPO-INTELLIDRAW\src\pages\WorkspacePage.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

lines = content.splitlines()

# Update findNodeDefinition
found_def_start = -1
for i, line in enumerate(lines):
    if "function findNodeDefinition" in line:
        found_def_start = i
        break

if found_def_start != -1:
    found_def_end = -1
    for j in range(found_def_start, found_def_start + 30):
        if lines[j].strip() == "}":
            found_def_end = j
            break
    if found_def_end != -1:
        new_def = [
            "function findNodeDefinition(mermaidCode: string, nodeId: string): string {",
            "  // Escape special regex chars in the node ID",
            '  const escaped = nodeId.replace(/[.*+?^${}()|[\\\\\\]]/g, "\\\\$&");',
            "",
            "  // Try matching subgraph definition: subgraph ID",
            '  const sgRegex = new RegExp(`^\\\\s*subgraph\\\\s+${escaped}(?:\\\\s+[\\\\\\\\[\\\\(\\\\{"\\\\w].*)?$`, "mi");',
            "  const sgMatch = mermaidCode.match(sgRegex);",
            "  if (sgMatch) {",
            "    return sgMatch[0].trim();",
            "  }",
            "",
            '  // Match the node ID followed by a shape opener: [ ( { or "',
            '  const regex = new RegExp(`^\\\\s*${escaped}\\\\s*([\\\\[\\\\(\\\\{"<])`, "m");',
            "  const match = mermaidCode.match(regex);",
            "  if (!match) return nodeId;",
            "",
            "  // Found the start — now extract the full definition up to end of line",
            "  const startIdx = mermaidCode.indexOf(match[0]);",
            '  const lineEnd = mermaidCode.indexOf("\\n", startIdx);',
            "  const line = lineEnd === -1",
            "    ? mermaidCode.slice(startIdx).trim()",
            "    : mermaidCode.slice(startIdx, lineEnd).trim();",
            "",
            "  return line;",
            "}"
        ]
        lines[found_def_start:found_def_end+1] = new_def
        print("Updated findNodeDefinition successfully!")

# Insert getClusterSubgraphId helper above export default function WorkspacePage
found_export = -1
for i, line in enumerate(lines):
    if "export default function WorkspacePage" in line:
        found_export = i
        break

if found_export != -1:
    helper_code = [
        "function getClusterSubgraphId(cluster: Element, parsedAST: MermaidAST | null): string | null {",
        "  if (!parsedAST) return null;",
        '  const labelEl = cluster.querySelector(".cluster-label");',
        "  if (!labelEl) return null;",
        '  const clusterLabelText = (labelEl.textContent || "").trim().toLowerCase();',
        "  if (!clusterLabelText) return null;",
        "",
        "  for (const sg of parsedAST.allSubgraphsFlat.values()) {",
        '    const normalizedLabel = sg.label.replace(/<br\\s*\\/?>/gi, " ").replace(/<[^>]+>/g, "").trim().toLowerCase();',
        "    if (clusterLabelText === normalizedLabel || clusterLabelText.includes(normalizedLabel) || normalizedLabel.includes(clusterLabelText)) {",
        "      return sg.id;",
        "    }",
        "  }",
        "  return null;",
        "}",
        ""
    ]
    lines[found_export:found_export] = helper_code
    print("Inserted getClusterSubgraphId helper successfully!")

# Update handlePointerDown
found_pointer_down = -1
for i, line in enumerate(lines):
    if "const handlePointerDown = (e: React.PointerEvent) => {" in line:
        found_pointer_down = i
        break

if found_pointer_down != -1:
    hit_test_start = -1
    hit_test_end = -1
    for j in range(found_pointer_down, found_pointer_down + 100):
        if 'const allNodes = canvasRef.current?.querySelectorAll(".node");' in lines[j]:
            hit_test_start = j
        if 'nodeTapRef.current = {' in lines[j] and hit_test_start != -1:
            for k in range(j, j + 50):
                if 'nodeTapRef.current = null;' in lines[k]:
                    if lines[k+1].strip() == "}":
                        hit_test_end = k + 1
                        break
            break
            
    if hit_test_start != -1 and hit_test_end != -1:
        new_hit_test = [
            '    let nodeEl: Element | null = null;',
            '    const allNodes = canvasRef.current?.querySelectorAll(".node");',
            '    if (allNodes) {',
            '      for (const node of allNodes) {',
            '        const r = node.getBoundingClientRect();',
            '        if (e.clientX >= r.left && e.clientX <= r.right &&',
            '            e.clientY >= r.top && e.clientY <= r.bottom) {',
            '          nodeEl = node;',
            '          break;',
            '        }',
            '      }',
            '    }',
            '',
            '    // Fallback: Check if pointer hit an expanded group (cluster)',
            '    if (!nodeEl) {',
            '      const allClusters = canvasRef.current?.querySelectorAll(".cluster");',
            '      if (allClusters) {',
            '        for (const cluster of allClusters) {',
            '          const r = cluster.getBoundingClientRect();',
            '          if (e.clientX >= r.left && e.clientX <= r.right &&',
            '              e.clientY >= r.top && e.clientY <= r.bottom) {',
            '            nodeEl = cluster;',
            '            break;',
            '          }',
            '        }',
            '      }',
            '    }',
            '',
            '    if (nodeEl) {',
            "      console.log('[NodeTap] ✅ Hit-test found node/cluster:', nodeEl.id || 'cluster', '— recording tap state');",
            '      nodeTapRef.current = {',
            '        nodeEl,',
            '        startX: e.clientX,',
            '        startY: e.clientY,',
            '        startTime: Date.now(),',
            '        pointerId: e.pointerId,',
            '      };',
            '    } else {',
            "      console.log('[NodeTap] ⚪ Hit-test found no node/cluster at', e.clientX, e.clientY);",
            '      nodeTapRef.current = null;',
            '    }'
        ]
        if 'let nodeEl' in lines[hit_test_start - 1]:
            lines[hit_test_start-1:hit_test_end+1] = new_hit_test
        else:
            lines[hit_test_start:hit_test_end+1] = new_hit_test
        print("Updated handlePointerDown successfully!")

# Update handlePointerUp
found_pointer_up = -1
for i, line in enumerate(lines):
    if "const handlePointerUp = (e: React.PointerEvent) => {" in line:
        found_pointer_up = i
        break

if found_pointer_up != -1:
    tap_block_start = -1
    tap_block_end = -1
    for j in range(found_pointer_up, found_pointer_up + 100):
        if 'const nodeEl = tapState.nodeEl;' in lines[j]:
            tap_block_start = j
        if 'handleNodeTap({ id: nodeId, label, rect });' in lines[j] and tap_block_start != -1:
            for k in range(j, j + 20):
                if lines[k].strip() == "} else {" and 'extractNodeId returned null' in lines[k+1]:
                    for l in range(k, k + 10):
                        if lines[l].strip() == "}":
                            tap_block_end = l
                            break
                    break
            break

    if tap_block_start != -1 and tap_block_end != -1:
        new_tap_block = [
            '        const nodeEl = tapState.nodeEl;',
            '        let nodeId: string | null = null;',
            '        let label = "";',
            '        let rect: DOMRect | null = null;',
            '',
            '        if (nodeEl.classList.contains("cluster")) {',
            '          nodeId = getClusterSubgraphId(nodeEl, parsedAST);',
            '          if (nodeId) {',
            '            const labelEl = nodeEl.querySelector(".cluster-label");',
            '            label = labelEl?.textContent?.trim() || nodeId;',
            '            rect = nodeEl.getBoundingClientRect();',
            '          }',
            '        } else {',
            '          const svgId = nodeEl.id || "";',
            '          nodeId = extractNodeId(svgId);',
            '          if (nodeId) {',
            '            const liveNode = canvasRef.current?.querySelector(`#${CSS.escape(svgId)}`) || nodeEl;',
            '            const labelEl = liveNode.querySelector(".nodeLabel");',
            '            label = labelEl?.textContent?.trim() || nodeId;',
            '            rect = liveNode.getBoundingClientRect();',
            '          }',
            '        }',
            '',
            '        if (nodeId && rect) {',
            '          // Check if this is a boundary (greyed-out external) node → navigate to its scope',
            '          if (isBoundaryNode(nodeId)) {',
            '            handleBoundaryNodeClick(nodeId);',
            '            return;',
            '          }',
            '',
            "          console.log('[NodeTap] ✅✅✅ CONFIRMED TAP — calling handleNodeTap:', { id: nodeId, label, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } });",
            '          handleNodeTap({ id: nodeId, label, rect });',
            '          return; // Don\'t also deselect',
            '        } else {',
            "          console.log('[NodeTap] ❌ Could not extract nodeId/rect for nodeEl:', nodeEl.id || 'cluster');",
            '        }'
        ]
        lines[tap_block_start:tap_block_end+1] = new_tap_block
        print("Updated handlePointerUp successfully!")

# Write back to file with proper newlines
with open(file_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
