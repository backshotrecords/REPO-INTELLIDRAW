import os

# 1. Modify WorkspacePage.tsx
wp_path = r"c:\Users\xx876\Downloads\REPO-INTELLIDRAW\src\pages\WorkspacePage.tsx"
with open(wp_path, "r", encoding="utf-8") as f:
    wp_content = f.read()

wp_lines = wp_content.splitlines()

wp_block_start = -1
for i, line in enumerate(wp_lines):
    if 'if (nodeEl.classList.contains("cluster")) {' in line:
        wp_block_start = i
        break

if wp_block_start != -1:
    wp_block_end = -1
    for j in range(wp_block_start, wp_block_start + 15):
        if wp_lines[j].strip() == "} else {":
            wp_block_end = j
            break
            
    if wp_block_end != -1:
        new_wp_block = [
            '        if (nodeEl.classList.contains("cluster")) {',
            '          nodeId = getClusterSubgraphId(nodeEl, parsedAST);',
            '          if (nodeId) {',
            '            let liveCluster = nodeEl;',
            '            const liveClusters = canvasRef.current?.querySelectorAll(".cluster");',
            '            if (liveClusters) {',
            '              for (const c of liveClusters) {',
            '                if (getClusterSubgraphId(c, parsedAST) === nodeId) {',
            '                  liveCluster = c;',
            '                  break;',
            '                }',
            '              }',
            '            }',
            '            const labelEl = liveCluster.querySelector(".cluster-label");',
            '            label = labelEl?.textContent?.trim() || nodeId;',
            '            const clusterRectEl = liveCluster.querySelector("rect");',
            '            rect = clusterRectEl ? clusterRectEl.getBoundingClientRect() : liveCluster.getBoundingClientRect();',
            '          }',
            '        } else {'
        ]
        wp_lines[wp_block_start:wp_block_end+1] = new_wp_block
        print("Updated WorkspacePage.tsx successfully!")

with open(wp_path, "w", encoding="utf-8") as f:
    f.write("\n".join(wp_lines))


# 2. Modify NodeActionOverlay.tsx
na_path = r"c:\Users\xx876\Downloads\REPO-INTELLIDRAW\src\components\NodeActionOverlay.tsx"
with open(na_path, "r", encoding="utf-8") as f:
    na_content = f.read()

na_lines = na_content.splitlines()

na_block_start = -1
for i, line in enumerate(na_lines):
    if "const gap = 12;" in line:
        na_block_start = i
        break

if na_block_start != -1:
    na_block_end = -1
    for j in range(na_block_start, na_block_start + 30):
        if "const resolvedActions = " in na_lines[j]:
            na_block_end = j
            break
            
    if na_block_end != -1:
        new_na_block = [
            '  const gap = 12;',
            '  const btnSize = 44;',
            '  const rollDistance = 10; // px lateral shift for roll effect',
            '',
            '  const viewportWidth = window.innerWidth;',
            '  const viewportHeight = window.innerHeight;',
            '  const spaceLeft = rect.left;',
            '  const spaceRight = viewportWidth - rect.right;',
            '  // Place on the left if space on the right is too small AND the left has more space',
            '  const placeLeft = spaceRight < (btnSize + gap + 40) && spaceLeft > spaceRight;',
            '',
            '  const isIn = phase === "visible";',
            '  const isExiting = phase === "exiting";',
            '',
            '  // Use last known actions during exit so buttons exist to animate out',
            '  const resolvedActions = actions.length > 0 ? actions : lastActionsRef.current;',
            '',
            '  // Clamp vertical position to keep the action menu fully on screen',
            '  const minTop = 60;',
            '  const maxTop = Math.max(minTop, viewportHeight - (resolvedActions.length * 48) - 20);',
            '  const top = Math.max(minTop, Math.min(maxTop, rect.top + rect.height / 2));',
            '',
            '  const baseLeft = placeLeft',
            '    ? Math.max(btnSize / 2 + 10, rect.left - gap - btnSize / 2)',
            '    : Math.min(viewportWidth - btnSize / 2 - 10, rect.right + gap + btnSize / 2);'
        ]
        na_lines[na_block_start:na_block_end+1] = new_na_block
        print("Updated NodeActionOverlay.tsx successfully!")

with open(na_path, "w", encoding="utf-8") as f:
    f.write("\n".join(na_lines))
