import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { apiGetRules, apiCreateRule, apiUpdateRule, apiDeleteRule } from "../lib/api";

interface Rule {
  id: string;
  rule_description: string;
  is_active: boolean;
  created_at: string;
}

export default function AdminPage() {
  const { user, isGlobalAdmin } = useAuth();
  const navigate = useNavigate();

  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRule, setNewRule] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    // Redirect if not an admin
    if (user && !user.isGlobalAdmin) {
      navigate("/dashboard", { replace: true });
      return;
    }

    loadRules();
  }, [user, navigate]);

  const loadRules = async () => {
    try {
      setLoading(true);
      const data = await apiGetRules();
      setRules(data);
    } catch (err) {
      console.error("Failed to load rules:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.trim()) return;

    setAdding(true);
    try {
      const added = await apiCreateRule(newRule.trim());
      setRules([added, ...rules]);
      setNewRule("");
    } catch (err) {
      console.error("Failed to add rule:", err);
    } finally {
      setAdding(false);
    }
  };

  const handleToggleRule = async (id: string, currentActive: boolean) => {
    try {
      setRules(rules.map((r) => (r.id === id ? { ...r, is_active: !currentActive } : r)));
      await apiUpdateRule(id, !currentActive);
    } catch (err) {
      console.error("Failed to toggle rule:", err);
      // Revert optimistic update
      setRules(rules.map((r) => (r.id === id ? { ...r, is_active: currentActive } : r)));
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;

    try {
      await apiDeleteRule(id);
      setRules(rules.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete rule:", err);
    }
  };

  return (
    <div className="bg-surface min-h-screen text-on-surface font-body p-6">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-center gap-4 border-b border-outline-variant/30 pb-6">
          <button
            onClick={() => navigate("/dashboard")}
            className="material-symbols-outlined p-2 rounded-full hover:bg-surface-container transition-colors"
          >
            arrow_back
          </button>
          <div>
            <h1 className="text-2xl font-bold font-manrope tracking-tight text-primary">Global Admin Dashboard</h1>
            <p className="text-sm text-on-surface-variant">Manage Evaluator Sanitization Rules</p>
          </div>
        </header>

        <section className="bg-white rounded-2xl p-6 border border-outline-variant/20 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight text-on-surface mb-4">Add Sanitization Rule</h2>
          <form onSubmit={handleAddRule} className="flex gap-3">
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              placeholder="e.g. Ensure all parentheses in node labels are replaced with text"
              className="flex-1 bg-surface-container-lowest border border-outline-variant/50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-primary/20 text-sm"
              disabled={adding}
            />
            <button
              type="submit"
              disabled={adding || !newRule.trim()}
              className="bg-primary text-white font-semibold px-6 py-3 rounded-xl hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              {adding ? "Adding..." : "Add Rule"}
            </button>
          </form>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-on-surface px-2">Active Rules ({rules.length})</h2>
          
          {loading ? (
            <div className="flex justify-center p-12">
              <span className="material-symbols-outlined animate-spin text-3xl text-primary">progress_activity</span>
            </div>
          ) : rules.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-2xl p-12 text-center border border-outline-variant/20 border-dashed">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/40 mb-2">rule</span>
              <p className="text-on-surface-variant font-medium">No rules defined yet.</p>
              <p className="text-sm text-on-surface-variant/60">Add a rule above to enforce conditions during Auto-Fix.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                    rule.is_active
                      ? "bg-white border-outline-variant/30 shadow-sm"
                      : "bg-surface-container-lowest border-outline-variant/20 opacity-70"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => handleToggleRule(rule.id, rule.is_active)}
                      className={`w-6 h-6 rounded-md flex items-center justify-center border transition-colors ${
                        rule.is_active
                          ? "bg-primary border-primary text-white"
                          : "bg-transparent border-on-surface-variant/30 text-transparent"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] font-bold">check</span>
                    </button>
                    <span className={`text-sm font-medium ${!rule.is_active && "line-through text-on-surface-variant"}`}>
                      {rule.rule_description}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-2 text-on-surface-variant hover:text-error hover:bg-error-container/30 rounded-lg transition-colors"
                    title="Delete rule"
                  >
                    <span className="material-symbols-outlined text-[20px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
