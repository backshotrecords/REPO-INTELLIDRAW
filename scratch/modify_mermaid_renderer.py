import os

file_path = r"c:\Users\xx876\Downloads\REPO-INTELLIDRAW\src\components\MermaidRenderer.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

lines = content.splitlines()

# 1. Insert import at the top
lines.insert(2, 'import type { MermaidAST } from "../utils/mermaidParser";')

# 2. Add parsedAST to MermaidRendererProps
props_end = -1
for i, line in enumerate(lines):
    if "interface MermaidRendererProps {" in line:
        for j in range(i, i + 30):
            if lines[j].strip() == "}":
                props_end = j
                break
        break

if props_end != -1:
    lines.insert(props_end, "  parsedAST?: MermaidAST | null;")
    print("Added parsedAST to MermaidRendererProps")

# 3. Add parsedAST to MermaidRenderer function signature
func_start = -1
for i, line in enumerate(lines):
    if "export default function MermaidRenderer({" in line:
        func_start = i
        break

if func_start != -1:
    for j in range(func_start, func_start + 10):
        if "}: MermaidRendererProps" in lines[j]:
            lines[j-1] = lines[j-1] + ", parsedAST"
            break

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
    # Insert helper before function
    for i, line in enumerate(lines):
        if "export default function MermaidRenderer" in line:
            func_start = i
            break
    lines[func_start:func_start] = helper_code
    print("Inserted getClusterSubgraphId helper into MermaidRenderer")

# 4. Modify the useEffect logic that applies classes
effect_start = -1
for i, line in enumerate(lines):
    if "// ── Apply visual state classes to SVG nodes ──" in line:
        effect_start = i
        break

if effect_start != -1:
    loop_end = -1
    for j in range(effect_start, min(len(lines), effect_start + 120)):
        if lines[j].strip() == "});" and any("nodes.forEach" in l for l in lines[max(0, j-45):j]):
            loop_end = j
            break
    
    if loop_end != -1:
        cluster_loop = [
            "",
            "    // Apply visual state classes to SVG clusters (expanded subgraphs)",
            '    const clusters = container.querySelectorAll(".cluster");',
            "    clusters.forEach((cluster) => {",
            "      const sgId = getClusterSubgraphId(cluster, parsedAST || null);",
            "      if (!sgId) return;",
            "",
            "      // Active state",
            "      if (activeNodeId === sgId) {",
            '        cluster.classList.add("cluster-active");',
            "      } else {",
            '        cluster.classList.remove("cluster-active");',
            "      }",
            "",
            "      // Selected state",
            "      if (selectedNodeIds?.includes(sgId)) {",
            '        cluster.classList.add("cluster-selected");',
            "      } else {",
            '        cluster.classList.remove("cluster-selected");',
            "      }",
            "    });"
        ]
        lines[loop_end+1:loop_end+1] = cluster_loop
        print("Added cluster class toggling to useEffect")
    else:
        print("Could not find nodes.forEach loop end!")

# 5. Make sure useEffect dependency array includes parsedAST
for i, line in enumerate(lines):
    if "}, [svgHtml, activeNodeId, selectedNodeIds, boundaryNodeIds, compoundNodeIds]);" in line:
        lines[i] = lines[i].replace("compoundNodeIds]);", "compoundNodeIds, parsedAST]);")
        print("Updated useEffect dependencies")
        break

# Write back to file
with open(file_path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
