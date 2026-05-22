import { useCallback, useEffect, useMemo, useState } from "react";
import TopBar from "../components/TopBar";
import BottomNav from "../components/BottomNav";
import { useAuth } from "../hooks/useAuth";
import {
  apiAddGroupMember,
  apiCreateGroup,
  apiDeleteGroup,
  apiListGroups,
  apiRemoveGroupMember,
  apiUpdateGroup,
} from "../lib/api";
import type { GroupMember, UserGroup } from "../types";

export default function UserManagementPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberMsg, setMemberMsg] = useState("");

  const ownedGroups = useMemo(() => groups.filter((group) => group.owner_id === user?.id), [groups, user?.id]);
  const sharedGroups = useMemo(() => groups.filter((group) => group.owner_id !== user?.id), [groups, user?.id]);
  const totalMembers = useMemo(
    () => ownedGroups.reduce((sum, group) => sum + (group.member_count || group.members?.length || 0), 0),
    [ownedGroups]
  );

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setGroups(await apiListGroups());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const handleCreateGroup = async () => {
    if (!newName.trim()) return;
    setError("");
    try {
      const group = await apiCreateGroup(newName.trim());
      setNewName("");
      setCreating(false);
      setExpandedId(group.id);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm("Delete this group? All members will lose access to shared skills.")) return;
    setError("");
    try {
      await apiDeleteGroup(id);
      if (expandedId === id) setExpandedId(null);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete group");
    }
  };

  const handleUpdateGroup = async (id: string) => {
    if (!editName.trim()) return;
    setError("");
    try {
      await apiUpdateGroup(id, editName.trim());
      setEditingId(null);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update group");
    }
  };

  const handleAddMember = async (groupId: string) => {
    if (!memberEmail.trim()) return;
    setMemberMsg("");
    try {
      await apiAddGroupMember(groupId, memberEmail.trim());
      setMemberEmail("");
      setMemberMsg("Member added");
      await loadGroups();
    } catch (err) {
      setMemberMsg(err instanceof Error ? err.message : "Failed to add member");
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    setError("");
    try {
      await apiRemoveGroupMember(groupId, userId);
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const renderGroup = (group: UserGroup) => {
    const isOwner = group.owner_id === user?.id;
    const isExpanded = expandedId === group.id;
    const isEditing = editingId === group.id;
    const members = group.members || [];

    return (
      <article key={group.id} className="rounded-xl border border-outline-variant/15 bg-white shadow-sm overflow-hidden">
        <button
          onClick={() => setExpandedId(isExpanded ? null : group.id)}
          className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-surface-container-lowest transition-colors"
        >
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
              group
            </span>
          </div>
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="flex flex-col sm:flex-row gap-2" onClick={(event) => event.stopPropagation()}>
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleUpdateGroup(group.id)}
                  autoFocus
                  className="flex-1 bg-surface-container-high rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-secondary/30"
                />
                <div className="flex gap-2">
                  <button onClick={() => handleUpdateGroup(group.id)} className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold">
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="px-4 py-2 rounded-lg text-on-surface-variant text-xs font-bold hover:bg-surface-container-high">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-headline text-lg font-bold text-on-surface truncate">{group.name}</h3>
                  {isOwner && <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 px-2 py-1 rounded-full">Owner</span>}
                </div>
                <p className="text-sm text-on-surface-variant">{group.member_count || members.length} members</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {isOwner && !isEditing && (
              <>
                <button
                  onClick={() => {
                    setEditingId(group.id);
                    setEditName(group.name);
                  }}
                  className="p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-primary/5"
                  title="Rename group"
                >
                  <span className="material-symbols-outlined text-lg">edit</span>
                </button>
                <button
                  onClick={() => handleDeleteGroup(group.id)}
                  className="p-2 rounded-full text-on-surface-variant hover:text-error hover:bg-error/5"
                  title="Delete group"
                >
                  <span className="material-symbols-outlined text-lg">delete</span>
                </button>
              </>
            )}
            <span className={`material-symbols-outlined text-on-surface-variant transition-transform ${isExpanded ? "rotate-180" : ""}`}>
              expand_more
            </span>
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-outline-variant/10 px-5 py-5 bg-surface-container-lowest/40 space-y-5">
            <div className="space-y-2">
              {members.length === 0 ? (
                <div className="rounded-lg border border-dashed border-outline-variant/30 bg-white px-4 py-6 text-center text-sm text-on-surface-variant">
                  No members yet
                </div>
              ) : (
                members.map((member: GroupMember) => (
                  <div key={member.id} className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 border border-outline-variant/10">
                    <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center text-sm font-bold text-on-surface-variant">
                      {(member.display_name || member.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-on-surface truncate">{member.display_name || "Unknown user"}</p>
                      <p className="text-xs text-on-surface-variant truncate">{member.email}</p>
                    </div>
                    {isOwner && (
                      <button
                        onClick={() => handleRemoveMember(group.id, member.user_id)}
                        className="p-2 rounded-full text-on-surface-variant hover:text-error hover:bg-error/5"
                        title="Remove member"
                      >
                        <span className="material-symbols-outlined text-lg">person_remove</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {isOwner && (
              <div className="rounded-lg bg-white border border-outline-variant/10 p-4">
                {addingToGroup === group.id ? (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={memberEmail}
                        onChange={(event) => setMemberEmail(event.target.value)}
                        onKeyDown={(event) => event.key === "Enter" && handleAddMember(group.id)}
                        placeholder="user@example.com"
                        autoFocus
                        className="flex-1 bg-surface-container-high rounded-lg px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary/30"
                      />
                      <button
                        onClick={() => handleAddMember(group.id)}
                        disabled={!memberEmail.trim()}
                        className="px-5 py-3 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40"
                      >
                        Add Member
                      </button>
                    </div>
                    {memberMsg && <p className="text-xs font-semibold text-on-surface-variant">{memberMsg}</p>}
                    <button
                      onClick={() => {
                        setAddingToGroup(null);
                        setMemberMsg("");
                      }}
                      className="text-xs font-bold text-on-surface-variant hover:text-on-surface"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAddingToGroup(group.id);
                      setMemberEmail("");
                      setMemberMsg("");
                    }}
                    className="inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
                  >
                    <span className="material-symbols-outlined text-lg">person_add</span>
                    Add member by email
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="bg-background font-body text-on-surface min-h-screen pb-32">
      <TopBar />

      <main className="max-w-6xl mx-auto px-6 pt-12 space-y-10">
        <section className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase text-primary">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>groups</span>
              Access
            </div>
            <div>
              <h2 className="text-4xl font-headline font-extrabold tracking-tight text-primary">User Management</h2>
              <p className="text-on-surface-variant text-lg max-w-2xl">
                Create groups, manage members, and organize who can receive shared skills from your workspace.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary text-white text-sm font-bold shadow-sm active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-lg">add</span>
            New Group
          </button>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl bg-white border border-outline-variant/15 p-5 shadow-sm">
            <p className="text-sm font-semibold text-on-surface-variant">Groups you own</p>
            <p className="text-3xl font-headline font-extrabold text-primary mt-2">{ownedGroups.length}</p>
          </div>
          <div className="rounded-xl bg-white border border-outline-variant/15 p-5 shadow-sm">
            <p className="text-sm font-semibold text-on-surface-variant">Members managed</p>
            <p className="text-3xl font-headline font-extrabold text-primary mt-2">{totalMembers}</p>
          </div>
          <div className="rounded-xl bg-white border border-outline-variant/15 p-5 shadow-sm">
            <p className="text-sm font-semibold text-on-surface-variant">Shared with you</p>
            <p className="text-3xl font-headline font-extrabold text-primary mt-2">{sharedGroups.length}</p>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-error/20 bg-error-container/30 px-5 py-4 text-sm font-semibold text-error">
            {error}
          </div>
        )}

        {creating && (
          <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <label className="text-sm font-bold text-on-surface">Group name</label>
            <div className="mt-3 flex flex-col sm:flex-row gap-3">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleCreateGroup()}
                placeholder="Design team, reviewers, operations..."
                autoFocus
                className="flex-1 bg-white rounded-lg px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-secondary/30"
              />
              <button
                onClick={handleCreateGroup}
                disabled={!newName.trim()}
                className="px-6 py-3 rounded-lg bg-primary text-white text-sm font-bold disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="px-6 py-3 rounded-lg text-on-surface-variant text-sm font-bold hover:bg-white"
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div>
              <h3 className="text-xl font-headline font-bold text-primary">Your Groups</h3>
              <p className="text-sm text-on-surface-variant mt-1">Groups you create can be used when sharing skills.</p>
            </div>
            {loading ? (
              <div className="rounded-xl bg-white border border-outline-variant/15 p-10 flex justify-center">
                <div className="spinner w-7 h-7" />
              </div>
            ) : ownedGroups.length === 0 ? (
              <div className="rounded-xl bg-white border border-dashed border-outline-variant/30 p-10 text-center">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/40">group_add</span>
                <p className="mt-3 font-bold text-on-surface">No groups yet</p>
                <p className="text-sm text-on-surface-variant mt-1">Create a group to share skill notes with multiple users at once.</p>
              </div>
            ) : (
              ownedGroups.map(renderGroup)
            )}
          </div>

          <aside className="space-y-4">
            <div>
              <h3 className="text-xl font-headline font-bold text-primary">Shared Groups</h3>
              <p className="text-sm text-on-surface-variant mt-1">Groups where another user has added you.</p>
            </div>
            {loading ? (
              <div className="rounded-xl bg-white border border-outline-variant/15 p-6 flex justify-center">
                <div className="spinner w-6 h-6" />
              </div>
            ) : sharedGroups.length === 0 ? (
              <div className="rounded-xl bg-white border border-outline-variant/15 p-6 text-sm text-on-surface-variant">
                You are not a member of any shared groups yet.
              </div>
            ) : (
              sharedGroups.map(renderGroup)
            )}
          </aside>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}
