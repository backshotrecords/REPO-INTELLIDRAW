import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import {
  apiListGroups, apiCreateGroup, apiUpdateGroup, apiDeleteGroup,
  apiAddGroupMember, apiRemoveGroupMember,
} from "../lib/api";
import type { UserGroup, GroupMember } from "../types";

interface UserGroupsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UserGroupsDialog({ isOpen, onClose }: UserGroupsDialogProps) {
  const { user } = useAuth();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create group
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Add member
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberMsg, setMemberMsg] = useState("");

  // Edit group
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try { setGroups(await apiListGroups()); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (isOpen) loadGroups(); }, [isOpen, loadGroups]);

  const handleCreateGroup = async () => {
    if (!newName.trim()) return;
    try {
      await apiCreateGroup(newName.trim());
      setNewName("");
      setCreating(false);
      loadGroups();
    } catch (err) { console.error(err); }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("Delete this group? All members will lose access to shared skills.")) return;
    try { await apiDeleteGroup(id); loadGroups(); } catch (err) { console.error(err); }
  };

  const handleUpdateGroup = async (id: string) => {
    if (!editName.trim()) return;
    try {
      await apiUpdateGroup(id, editName.trim());
      setEditingId(null);
      loadGroups();
    } catch (err) { console.error(err); }
  };

  const handleAddMember = async (groupId: string) => {
    if (!memberEmail.trim()) return;
    setMemberMsg("");
    try {
      await apiAddGroupMember(groupId, memberEmail.trim());
      setMemberEmail("");
      setMemberMsg("✅ Member added!");
      loadGroups();
    } catch (err) {
      setMemberMsg(`❌ ${err instanceof Error ? err.message : "Failed"}`);
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try { await apiRemoveGroupMember(groupId, userId); loadGroups(); }
    catch (err) { console.error(err); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="px-6 py-5 border-b border-outline-variant/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>groups</span>
            </div>
            <div>
              <h3 className="text-lg font-bold text-on-surface">User Groups</h3>
              <p className="text-xs text-on-surface-variant">Manage groups to share skills with teams</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-container-high text-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 no-scrollbar">
          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner w-6 h-6" /></div>
          ) : groups.length === 0 && !creating ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-on-surface-variant/40">
              <span className="material-symbols-outlined text-4xl">group_add</span>
              <p className="text-sm font-medium">No groups yet</p>
              <p className="text-xs text-center max-w-[250px]">Create a group to share skill notes with multiple users at once</p>
            </div>
          ) : (
            groups.map(group => {
              const isOwner = group.owner_id === user?.id;
              const isExpanded = expandedId === group.id;
              const isEditing = editingId === group.id;

              return (
                <div key={group.id} className="border border-outline-variant/15 rounded-xl overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-lowest cursor-pointer hover:bg-surface-container-low transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : group.id)}>
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>group</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                            onKeyDown={e => e.key === "Enter" && handleUpdateGroup(group.id)}
                            className="flex-1 bg-surface-container-high rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-secondary" />
                          <button onClick={() => handleUpdateGroup(group.id)} className="text-primary text-xs font-bold">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-on-surface-variant text-xs">Cancel</button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-semibold text-on-surface">{group.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-on-surface-variant/50">{group.member_count || 0} members</span>
                            {isOwner && <span className="text-[9px] font-bold text-primary uppercase bg-primary/10 px-1.5 py-0.5 rounded-full">owner</span>}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      {isOwner && (
                        <>
                          <button onClick={() => { setEditingId(group.id); setEditName(group.name); }}
                            className="p-1 text-on-surface-variant/40 hover:text-primary rounded-md transition-colors">
                            <span className="material-symbols-outlined text-sm">edit</span>
                          </button>
                          <button onClick={() => handleDeleteGroup(group.id)}
                            className="p-1 text-on-surface-variant/40 hover:text-error rounded-md transition-colors">
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        </>
                      )}
                      <span className={`material-symbols-outlined text-on-surface-variant/40 text-sm transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                        expand_more
                      </span>
                    </div>
                  </div>

                  {/* Expanded members */}
                  {isExpanded && (
                    <div className="border-t border-outline-variant/10 px-4 py-3 space-y-2 bg-white">
                      {(group.members || []).length === 0 ? (
                        <p className="text-xs text-on-surface-variant/50 italic py-2">No members yet</p>
                      ) : (
                        (group.members || []).map((m: GroupMember) => (
                          <div key={m.id} className="flex items-center gap-3 py-1.5 group/member">
                            <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-bold text-on-surface-variant">
                              {(m.display_name || m.email || "?").charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-on-surface truncate block">{m.display_name || "Unknown"}</span>
                              <span className="text-[10px] text-on-surface-variant/50 truncate block">{m.email}</span>
                            </div>
                            {isOwner && (
                              <button onClick={() => handleRemoveMember(group.id, m.user_id)}
                                className="opacity-0 group-hover/member:opacity-100 p-1 text-on-surface-variant/40 hover:text-error rounded-md transition-all">
                                <span className="material-symbols-outlined text-sm">person_remove</span>
                              </button>
                            )}
                          </div>
                        ))
                      )}

                      {/* Add member */}
                      {isOwner && (
                        <div className="pt-2 border-t border-outline-variant/10">
                          {addingToGroup === group.id ? (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <input value={memberEmail} onChange={e => setMemberEmail(e.target.value)}
                                  placeholder="user@example.com" autoFocus
                                  onKeyDown={e => e.key === "Enter" && handleAddMember(group.id)}
                                  className="flex-1 bg-surface-container-high rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-secondary" />
                                <button onClick={() => handleAddMember(group.id)}
                                  className="px-3 py-2 text-xs font-bold bg-primary text-white rounded-lg active:scale-95 transition-all">Add</button>
                              </div>
                              {memberMsg && <p className="text-xs">{memberMsg}</p>}
                              <button onClick={() => { setAddingToGroup(null); setMemberMsg(""); }}
                                className="text-xs text-on-surface-variant hover:text-on-surface">Cancel</button>
                            </div>
                          ) : (
                            <button onClick={() => { setAddingToGroup(group.id); setMemberEmail(""); setMemberMsg(""); }}
                              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors">
                              <span className="material-symbols-outlined text-sm">person_add</span>Add Member
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Create group */}
          {creating ? (
            <div className="border border-primary/20 rounded-xl px-4 py-3 bg-primary/5">
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Group name" autoFocus
                onKeyDown={e => e.key === "Enter" && handleCreateGroup()}
                className="w-full bg-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-secondary mb-2" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setCreating(false)} className="text-xs font-semibold text-on-surface-variant">Cancel</button>
                <button onClick={handleCreateGroup} disabled={!newName.trim()}
                  className="px-4 py-1.5 text-xs font-bold bg-primary text-white rounded-lg disabled:opacity-40 active:scale-95 transition-all">Create</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-outline-variant/20 rounded-xl text-sm font-semibold text-on-surface-variant hover:text-primary hover:border-primary/30 transition-colors">
              <span className="material-symbols-outlined text-lg">add</span>
              Create Group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
