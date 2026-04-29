import { useState, useEffect, useRef, useCallback } from "react";
import { apiGetModels, apiSetActiveModel } from "../lib/api";
import { useAuth } from "../hooks/useAuth";

interface AIModel {
  id: string;
  model_id: string;
  label: string;
  added_at: string;
}

export default function ModelPicker() {
  const { refreshUser } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [models, setModels] = useState<AIModel[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch models on mount
  const loadModels = useCallback(async () => {
    try {
      const data = await apiGetModels();
      setModels(data.models || []);
      setActiveModelId(data.activeModelId || null);
    } catch (err) {
      console.error("Failed to load models:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Initialize highlight to active model when opened
  useEffect(() => {
    if (isOpen && models.length > 0) {
      const activeIdx = models.findIndex((m) => m.id === activeModelId);
      setHighlightedIndex(activeIdx >= 0 ? activeIdx : 0);
    }
  }, [isOpen, models, activeModelId]);

  // Keyboard navigation: ESC, Arrow keys, Enter
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          setIsOpen(false);
          break;
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < models.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : models.length - 1
          );
          break;
        case "Enter":
          e.preventDefault();
          if (models[highlightedIndex]) {
            handleSelectModel(models[highlightedIndex]);
          }
          break;
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, models, highlightedIndex]);

  // Alt+S (⌥S) to toggle model picker
  useEffect(() => {
    const handleAltS = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyS") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleAltS);
    return () => document.removeEventListener("keydown", handleAltS);
  }, []);

  // Optimistic model switch
  const handleSelectModel = async (model: AIModel) => {
    const previousActiveId = activeModelId;

    // Update UI immediately
    setActiveModelId(model.id);
    setIsOpen(false);

    // Persist in background
    try {
      await apiSetActiveModel(model.id);
      await refreshUser();
    } catch (err) {
      console.error("Failed to switch model:", err);
      // Roll back on failure
      setActiveModelId(previousActiveId);
    }
  };

  const selectedModel = models.find((m) => m.id === activeModelId);

  // Loading skeleton
  if (loading) {
    return (
      <div className="px-4 py-3 border-t border-outline-variant/10">
        <div className="flex items-center justify-between px-4 py-3 bg-surface-container-high/50 rounded-2xl animate-pulse">
          <div className="space-y-1.5">
            <div className="w-16 h-2 bg-outline-variant/20 rounded-full" />
            <div className="w-24 h-3.5 bg-outline-variant/30 rounded-full" />
          </div>
          <div className="w-5 h-5 bg-outline-variant/20 rounded-full" />
        </div>
      </div>
    );
  }

  // No models configured
  if (models.length === 0) {
    return (
      <div className="px-4 py-3 border-t border-outline-variant/10">
        <div className="flex items-center gap-3 px-4 py-3 bg-surface-container-high/30 rounded-2xl">
          <span
            className="material-symbols-outlined text-base text-on-surface-variant/40"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            model_training
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wider leading-none">
              No Models
            </p>
            <p className="text-[11px] text-on-surface-variant/50 mt-0.5">
              Add models in{" "}
              <a
                href="/settings"
                className="text-secondary font-semibold hover:underline"
              >
                Settings
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative px-4 py-3 border-t border-outline-variant/10" ref={pickerRef}>
      {/* Dropdown menu — opens upward */}
      {isOpen && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden z-40 animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-outline-variant/10 bg-surface-container-high/30 flex justify-between items-center">
            <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-widest">
              Switch Model
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant/50 font-mono">↑↓</span>
              <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant/50 font-mono">↵</span>
              <span className="text-[9px] bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant/50 font-mono">ESC</span>
            </span>
          </div>

          {/* Model list */}
          <div className="py-1 max-h-60 overflow-y-auto" ref={listRef}>
            {models.map((model, index) => {
              const isActive = activeModelId === model.id;
              const isHighlighted = highlightedIndex === index;
              return (
                <button
                  key={model.id}
                  ref={(el) => {
                    if (isHighlighted && el) {
                      el.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  onClick={() => handleSelectModel(model)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-all border-l-4 ${
                    isHighlighted
                      ? "bg-surface-container-high/80 text-on-surface border-secondary/60"
                      : isActive
                        ? "bg-secondary/5 text-on-surface border-secondary"
                        : "text-on-surface-variant border-transparent hover:bg-surface-container-high/60 hover:text-on-surface hover:border-outline-variant/40"
                  }`}
                >
                  <span
                    className={`flex-1 text-[13px] font-mono tracking-tight ${
                      isActive ? "font-bold" : "font-medium"
                    }`}
                  >
                    {model.model_id}
                  </span>
                  {model.label && model.label !== model.model_id && (
                    <span className="text-[10px] text-on-surface-variant/50 truncate max-w-[80px]">
                      {model.label}
                    </span>
                  )}
                  {isActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-secondary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl hover:border-outline-variant/40 hover:bg-surface-container-high/30 transition-all shadow-sm group"
      >
        <div className="text-left min-w-0">
          <div className="text-[9px] font-bold text-on-surface-variant/50 uppercase leading-none mb-1 tracking-wider">
            Active Model
          </div>
          <div className="text-[13px] font-bold text-on-surface font-mono leading-none tracking-tight truncate">
            {selectedModel?.model_id || "No model selected"}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-block text-[10px] text-on-surface-variant/40 border border-outline-variant/20 px-1.5 py-0.5 rounded-md bg-surface-container-high/50 font-mono">
            ⌥ S
          </span>
          <span className="material-symbols-outlined text-xl text-on-surface-variant/50 transition-transform duration-200 group-hover:text-on-surface-variant">
            {isOpen ? "expand_more" : "expand_less"}
          </span>
        </div>
      </button>
    </div>
  );
}
